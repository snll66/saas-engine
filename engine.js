const WORKER_URL = process.env.WORKER_URL;
const ADMIN_PWD = process.env.ADMIN_PWD;

// 🤖 专属 TG 直播播报员
class TgLogger {
    constructor(profile) {
        this.profile = profile;
        this.msgId = null;
        this.text = '';
    }
    
    async log(msg) {
        console.log(msg.replace(/<[^>]*>?/gm, '')); 
        if (!this.profile || !this.profile.tgToken || !this.profile.tgChatId) return;
        
        this.text += (this.text ? '\n' : '') + msg;
        try {
            const headers = { 'X-Admin-Password': ADMIN_PWD, 'Content-Type': 'application/json' };
            const body = JSON.stringify({
                tgToken: this.profile.tgToken, 
                tgChatId: this.profile.tgChatId, 
                text: this.text,
                message_id: this.msgId
            });

            if (!this.msgId) {
                const res = await fetch(`${WORKER_URL}/api/saas/tg_send`, { method: 'POST', headers, body }).then(r => r.json()).catch(()=>({}));
                if (res.result) this.msgId = res.result.message_id;
            } else {
                await fetch(`${WORKER_URL}/api/saas/tg_edit`, { method: 'POST', headers, body }).catch(()=>{});
            }
        } catch(e) {}
    }
}

// 🛡️ 智能全域打码：前缀保留首字母，主域名半打码
const maskDomain = (host, base) => {
    if (!host || !base || !host.endsWith(base)) return host;
    const prefix = host.substring(0, host.length - base.length); 
    if (!prefix) return base;
    
    const firstChar = prefix.charAt(0);
    const maskedPrefix = firstChar + prefix.substring(1).replace(/[a-zA-Z0-9]/g, '*');
    
    const baseParts = base.split('.');
    const maskedBase = baseParts.map((p, idx, arr) => {
        if (idx === arr.length - 1) return p; 
        if (p.length <= 2) return '*'.repeat(p.length);
        return p.charAt(0) + '*'.repeat(p.length - 2) + p.charAt(p.length - 1);
    }).join('.');
    
    return maskedPrefix + maskedBase;
};

// 🚀 域名生成规则
const generateHostPattern = (pattern, baseDomain) => {
    if (!pattern) pattern = "[4].[3].[base]";
    let h = pattern.replace(/\[base\]/g, baseDomain);
    h = h.replace(/\[([^\]]+)\]/g, (_, val) => {
        let len = parseInt(val);
        if (isNaN(len)) len = val.length;
        let res = '';
        while (res.length < len) res += Math.random().toString(36).substring(2);
        return res.substring(0, len);
    });
    return h.replace(/[^a-zA-Z0-9.-]/g, '');
};

async function run() {
    console.log("🚀 开始执行 SaaS 幽灵协议...");
    const headers = { 'X-Admin-Password': ADMIN_PWD, 'Content-Type': 'application/json' };
    const [profilesRes, autoConfigRes] = await Promise.all([
        fetch(`${WORKER_URL}/api/saas/profiles`, { headers }),
        fetch(`${WORKER_URL}/api/saas/auto_config`, { headers })
    ]);

    const profiles = await profilesRes.json();
    const config = await autoConfigRes.json();

    if (!config || !config.batches || config.batches.length === 0) return console.log("💤 无任务。");

    let currentIndex = config.currentIndex || 0;
    if (currentIndex >= config.batches.length) currentIndex = 0;
    const currentBatch = config.batches[currentIndex];
    
    for (const task of currentBatch) {
        const profile = profiles.find(p => p.name === task.profileName);
        if (!profile) continue;

        const tg = new TgLogger(profile);
        await tg.log(`💀 <b>GlassPanel 幽灵协议 [${currentIndex + 1}/${config.batches.length}] 激活</b>`);
        
        // 1. 💥 强化：核弹级物理清场（彻底解决旧域名删不掉的问题）
        await tg.log(`🗑️ 启动最高权限，强行抹除云端历史残留...`);
        try {
            // (1) 仍然通知 Worker 清理面板数据库
            await fetch(`${WORKER_URL}/api/saas/cleanup`, {
                method: 'POST', headers,
                body: JSON.stringify({ profileName: profile.name, baseDomain: profile.baseDomain, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, snippetRule: profile.snippetRule || '' })
            }).catch(()=>{});

            // (2) 直接向 Cloudflare 官方 API 索要所有当前主机名，发现旧的直接击毙！
            const cfHeaders = { 'Authorization': `Bearer ${profile.apiToken}`, 'Content-Type': 'application/json' };
            const listRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${profile.saasZoneId}/custom_hostnames?per_page=100`, { headers: cfHeaders }).then(r => r.json()).catch(()=>({}));
            
            if (listRes.success && listRes.result) {
                let deletedCount = 0;
                for (const ch of listRes.result) {
                    // 如果该主机名是以你的 baseDomain 结尾（且不是它本身），统统物理销毁
                    if (ch.hostname.endsWith(profile.baseDomain) && ch.hostname !== profile.baseDomain) {
                        await fetch(`https://api.cloudflare.com/client/v4/zones/${profile.saasZoneId}/custom_hostnames/${ch.id}`, { method: 'DELETE', headers: cfHeaders });
                        deletedCount++;
                    }
                }
                if (deletedCount > 0) await tg.log(`💥 物理销毁了 ${deletedCount} 个上轮遗留废弃节点！`);
            }
            await tg.log(`✅ 云端防线已被清空，配额绝对干净。`);
        } catch (e) {}

        await tg.log(`👁️ <b>目标代号: ${profile.name}</b> (分配 ${task.count} 个动态掩码)`);
        
        // 2. 并发创建
        const pendingHosts = [];
        for (let i = 0; i < task.count; i++) {
            const host = generateHostPattern(profile.domainPattern, profile.baseDomain); 
            const mask = maskDomain(host, profile.baseDomain); 
            await tg.log(`▶ [身份伪造 ${i+1}/${task.count}] 幽灵 ${mask} 生成中...`);
            
            const createRes = await fetch(`${WORKER_URL}/api/saas/step_create`, {
                method: 'POST', headers,
                body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostname: host })
            }).then(r => r.json()).catch(() => ({}));

            if (createRes.success) pendingHosts.push({ id: createRes.hostId, host: host, mask: mask, index: i+1, retryCount: 0 });
        }

        // 3. 验证与精准补发
        let activeHosts = [];
        for (let w = 0; w < 24; w++) { 
            await new Promise(r => setTimeout(r, 10000)); 
            for (let item of pendingHosts) {
                if (activeHosts.includes(item.host)) continue;

                const statusRes = await fetch(`${WORKER_URL}/api/saas/step_status`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, hostId: item.id })
                }).then(r => r.json()).catch(() => ({ active: false }));

                if (statusRes.active) {
                    activeHosts.push(item.host);
                    await tg.log(` ✅ [${item.index}] 幽灵 ${item.mask} 潜行成功`);
                } else {
                    if (item.retryCount < 2) {
                        item.retryCount++;
                        await tg.log(`🔄 [${item.index}] ${item.mask} 验证缺失，正在重写 TXT 记录 (第 ${item.retryCount} 次)`);
                        await fetch(`${WORKER_URL}/api/saas/step_ssl`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostId: item.id })
                        }).catch(() => {});
                    }
                }
            }
            if (activeHosts.length === pendingHosts.length) break;
        }

        // 4. 同步面板
        if (activeHosts.length > 0) {
            let successCount = 0;
            for (const host of activeHosts) {
                const syncRes = await fetch(`${WORKER_URL}/api/saas/sync_domain`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ profileName: profile.name, baseDomain: profile.baseDomain, hostname: host })
                }).then(r => r.json()).catch(()=>({}));
                if (syncRes.success) successCount++;
            }
            await tg.log(`🎉 <b>成功下发 ${successCount} 个免杀隐蔽节点</b>`);
        }

        // 5. 💥 兜底物理清场：处理本次超时的坏死节点
        const failedHosts = pendingHosts.filter(p => !activeHosts.includes(p.host));
        if (failedHosts.length > 0) {
            await tg.log(`\n💥 发现 ${failedHosts.length} 个遭遇深层干扰的掩码，立刻执行销毁...`);
            for (const item of failedHosts) {
                try {
                    await fetch(`https://api.cloudflare.com/client/v4/zones/${profile.saasZoneId}/custom_hostnames/${item.id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${profile.apiToken}`, 'Content-Type': 'application/json' }
                    });
                } catch(e) {}
            }
            await tg.log(`✅ 暴露掩码已销毁，拒绝病态节点入库。`);
        }

        await tg.log(`\n🏁 <b>幽灵行动结束，切断所有外部连接。</b>`);
    }

    config.currentIndex = (currentIndex + 1) % config.batches.length;
    await fetch(`${WORKER_URL}/api/saas/auto_config`, { method: 'POST', headers, body: JSON.stringify({ password: ADMIN_PWD, config: config }) });
}

run();
