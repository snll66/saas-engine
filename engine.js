// ==========================================
// 🧹 强化版：严格状态同步清理引擎 (修复清理不干净Bug)
// ==========================================
const cleanupOldHosts = async (env, profile, logTg = null) => {
    const key = `managed_${profile.name}`;
    const managed = await storageGet(env, key) || [];
    let cfDeleteSuccessCount = 0;
    let cfDeleteFailCount = 0;
    let failedHostnames = [];

    // 1. 严格按账本清理云端 CF 记录 (带状态校验)
    if (managed.length > 0) {
        if(logTg) await logTg(`🧹 [${profile.name}] 开始清理上次生成的 ${managed.length} 个动态域名...`);
        
        for (let host of managed) {
            let isHostCleaned = true; // 假设初始为干净
            
            // 清理 DNS 记录
            const targetDnsZoneId = await getTargetDnsZoneId(host.hostname, profile.apiToken, profile.dnsZoneId);
            for (let dId of (host.dnsIds || [])) {
                try {
                    const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${targetDnsZoneId}/dns_records/${dId}`, {
                        method: 'DELETE', headers: getCfHeaders(profile.apiToken)
                    });
                    const delData = await delRes.json();
                    if (!delData.success) {
                        isHostCleaned = false;
                        if(logTg) await logTg(`⚠️ DNS ${dId} 删除失败: ${delData.errors[0]?.message}`);
                    }
                } catch(e) {
                    isHostCleaned = false;
                    if(logTg) await logTg(`⚠️ DNS ${dId} 请求异常: ${e.message}`);
                }
            }
            
            // 清理 Custom Hostname
            try {
                const chRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${profile.saasZoneId}/custom_hostnames/${host.hostId}`, {
                    method: 'DELETE', headers: getCfHeaders(profile.apiToken)
                });
                const chData = await chRes.json();
                if (!chData.success) {
                    isHostCleaned = false;
                    if(logTg) await logTg(`⚠️ Hostname ${host.hostId} 删除失败: ${chData.errors[0]?.message}`);
                }
            } catch(e) {
                isHostCleaned = false;
                if(logTg) await logTg(`⚠️ Hostname ${host.hostId} 请求异常: ${e.message}`);
            }

            // 🌟 核心修复：只有 CF 云端真正删干净了，才计入成功数
            if (isHostCleaned) {
                cfDeleteSuccessCount++;
            } else {
                cfDeleteFailCount++;
                failedHostnames.push(host.hostname); // 记录失败域名，绝不能从账本剔除！
            }
        }
        
        if(logTg) await logTg(`📊 账本清理结果: 成功 ${cfDeleteSuccessCount} 个，失败 ${cfDeleteFailCount} 个`);
    }

    // 🚀 2. 终极兜底：全量拉取 CF 云端，直接比对抹杀（不依赖本地账本）
    if(logTg) await logTg(`🔎 启动云端全量扫描，防止孤儿域名逃逸...`);
    let orphanKilled = 0;
    
    try {
        // 拉取 SaaS Zone 下的所有 Custom Hostnames
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const listRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${profile.saasZoneId}/custom_hostnames?per_page=100&page=${page}`, {
                headers: getCfHeaders(profile.apiToken)
            });
            const listData = await listRes.json();
            
            if (!listData.success) break;
            
            for (let ch of listData.result) {
                const hostname = ch.hostname;
                // 只处理属于该 baseDomain 的子域名
                if (hostname !== profile.baseDomain && hostname.endsWith(`.${profile.baseDomain}`)) {
                    // 检查是否在失败列表或已成功列表里，避免重复删
                    const isAlreadyHandled = managed.some(m => m.hostname === hostname);
                    if (!isAlreadyHandled) {
                        if(logTg) await logTg(`💀 发现孤儿域名: ${hostname}，执行云端抹杀...`);
                        try {
                            await fetch(`https://api.cloudflare.com/client/v4/zones/${profile.saasZoneId}/custom_hostnames/${ch.id}`, {
                                method: 'DELETE', headers: getCfHeaders(profile.apiToken)
                            });
                            // 同步清理其 DNS 记录
                            const ghostZoneId = await getTargetDnsZoneId(hostname, profile.apiToken, profile.dnsZoneId);
                            const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${ghostZoneId}/dns_records?name=${hostname}`, {
                                headers: getCfHeaders(profile.apiToken)
                            });
                            const dnsData = await dnsRes.json();
                            if (dnsData.success) {
                                for (let r of dnsData.result) {
                                    await fetch(`https://api.cloudflare.com/client/v4/zones/${ghostZoneId}/dns_records/${r.id}`, {
                                        method: 'DELETE', headers: getCfHeaders(profile.apiToken)
                                    });
                                }
                            }
                            orphanKilled++;
                        } catch(e) {
                            if(logTg) await logTg(`⚠️ 孤儿 ${hostname} 抹杀异常: ${e.message}`);
                        }
                    }
                }
            }
            
            // 判断是否还有下一页
            const resultInfo = listData.result_info;
            if (!resultInfo || page >= resultInfo.total_pages) {
                hasMore = false;
            } else {
                page++;
            }
        }
    } catch(e) {
        if(logTg) await logTg(`⚠️ 全量扫描过程异常: ${e.message}`);
    }

    // 3. 更新本地账本：只剔除云端确认删除成功的，保留失败的！
    let newManaged = managed.filter(m => failedHostnames.includes(m.hostname));
    await storagePut(env, key, newManaged);

    // 4. 强制同步清理主面板配置 (剔除所有该 profile 的动态域名)
    let glassConfig = await storageGet(env, "user_config") || {};
    let servers = glassConfig.servers || [];
    let targetServerIndex = servers.findIndex(s => s.name === profile.name);
    
    // 兜底匹配
    if (targetServerIndex === -1 && profile.baseDomain) {
        targetServerIndex = servers.findIndex(s => {
            let h = s.host.split('\n').map(x=>x.trim()).filter(x=>x);
            return h.length > 0 && h[0] === profile.baseDomain;
        });
    }

    if (targetServerIndex !== -1) {
        let hosts = servers[targetServerIndex].host.split('\n').map(h => h.trim()).filter(h => h);
        // 只保留基础域名，或者其他非该 baseDomain 的域名
        let remainingHosts = hosts.filter(h => h === profile.baseDomain || !h.endsWith(`.${profile.baseDomain}`));
        
        let newHostStr = remainingHosts.join('\n');
        if (servers[targetServerIndex].host !== newHostStr) {
            servers[targetServerIndex].host = newHostStr;
            glassConfig.servers = servers;
            await storagePut(env, "user_config", glassConfig);
            if(logTg) await logTg(`🧹 主面板配置已强制剔除动态域名。`);
        }
    }
    
    if(logTg) await logTg(`✅ 清理引擎休眠 (账本:${cfDeleteSuccessCount}成功/${cfDeleteFailCount}失败保留, 孤儿抹杀:${orphanKilled}个)`);
    
    // 🌟 核心返回值：告诉调用者是否有未清理干净的失败项
    return { success: cfDeleteFailCount === 0, failedCount: cfDeleteFailCount, orphanKilled };
};
