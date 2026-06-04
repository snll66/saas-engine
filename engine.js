const WORKER_URL = process.env.WORKER_URL;
const ADMIN_PWD = process.env.ADMIN_PWD;

async function run() {
    console.log("🚀 开始向 Worker 请求 SaaS 任务配置...");
    
    const headers = { 'X-Admin-Password': ADMIN_PWD, 'Content-Type': 'application/json' };
    const [profilesRes, autoConfigRes] = await Promise.all([
        fetch(`${WORKER_URL}/api/saas/profiles`, { headers }),
        fetch(`${WORKER_URL}/api/saas/auto_config`, { headers })
    ]);

    const profiles = await profilesRes.json();
    const config = await autoConfigRes.json();

    if (!config || !config.batches || config.batches.length === 0) {
        return console.log("💤 当前面板没有配置任何轮询批次任务。");
    }

    let currentIndex = config.currentIndex || 0;
    if (currentIndex >= config.batches.length) currentIndex = 0;
    const currentBatch = config.batches[currentIndex];
    
    console.log(`📦 本次执行第 ${currentIndex + 1} 批次，包含 ${currentBatch.length} 个任务`);

    for (const task of currentBatch) {
        const profile = profiles.find(p => p.name === task.profileName);
        if (!profile) continue;

        console.log(`\n🌐 正在处理: ${profile.name}, 数量: ${task.count}`);
        
        // ==========================================
        // 🧹 新增：发车前，先强制清理云端和面板的旧域名
        // ==========================================
        console.log(`🧹 正在清理上一批的旧域名与云端残留 DNS...`);
        try {
            const cleanupRes = await fetch(`${WORKER_URL}/api/saas/cleanup`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    profileName: profile.name,
                    baseDomain: profile.baseDomain,
                    apiToken: profile.apiToken,
                    saasZoneId: profile.saasZoneId,
                    dnsZoneId: profile.dnsZoneId,
                    snippetRule: profile.snippetRule || ''
                })
            });
            if (cleanupRes.ok) {
                console.log(`✅ 旧域名清理完毕！`);
            } else {
                console.log(`⚠️ 清理接口响应异常，将继续尝试创建新域名。`);
            }
        } catch (e) {
            console.log(`❌ 清理请求失败，跳过清理继续执行: ${e.message}`);
        }
        // ==========================================

        const successfulHosts = [];
        const pendingHosts = [];

        // 发起创建请求
        for (let i = 0; i < task.count; i++) {
            const host = profile.baseDomain.replace('xxx', Math.random().toString(36).substring(2, 8)); 
            console.log(`请求创建: ${host}`);
            
            const createRes = await fetch(`${WORKER_URL}/api/saas/step_create`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostname: host
                })
            }).then(r => r.json()).catch(() => ({}));

            if (createRes.success) {
                pendingHosts.push({ id: createRes.hostId, host: host });
            }
        }

        console.log(`⏳ 开始下发证书验证记录并等待生效，请耐心等待...`);
        for (const item of pendingHosts) {
            let sslReady = false;
            for(let w=0; w<6; w++) { 
                await new Promise(r => setTimeout(r, 10000));
                const sslRes = await fetch(`${WORKER_URL}/api/saas/step_ssl`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostId: item.id })
                }).then(r => r.json()).catch(() => ({}));
                
                if (sslRes.ready) {
                    sslReady = true;
                    console.log(`  └ 证书 TXT 验证记录下发成功`);
                    break;
                }
            }

            if (!sslReady) {
                console.log(`❌ ${item.host} TXT 获取超时，跳过`);
                continue;
            }

            let active = false;
            for(let w=0; w<24; w++) { 
                await new Promise(r => setTimeout(r, 10000));
                const statusRes = await fetch(`${WORKER_URL}/api/saas/step_status`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, hostId: item.id })
                }).then(r => r.json()).catch(() => ({}));
                
                if (statusRes.active) {
                    active = true;
                    successfulHosts.push(item.host);
                    console.log(`✅ ${item.host} 验证成功，已激活！`);
                    break;
                }
            }

            if (!active) {
                console.log(`⚠️ ${item.host} 激活超时，已放入后台队列等待 CF 自然生效。`);
                successfulHosts.push(item.host);
            }
        }

        if (successfulHosts.length > 0) {
            console.log(`🔗 正在将 ${successfulHosts.length} 个新域名同步至面板...`);
            await fetch(`${WORKER_URL}/api/gha/sync_results`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    secret: ADMIN_PWD,
                    profileName: profile.name,
                    baseDomain: profile.baseDomain,
                    tgToken: profile.tgToken,
                    tgChatId: profile.tgChatId,
                    successfulHosts: successfulHosts
                })
            });
        }
    }

    config.currentIndex = (currentIndex + 1) % config.batches.length;
    await fetch(`${WORKER_URL}/api/saas/auto_config`, {
        method: 'POST', headers,
        body: JSON.stringify({ password: ADMIN_PWD, config: config })
    });
    
    console.log("🎉 引擎运行完毕！");
}

run();
