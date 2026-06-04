const WORKER_URL = process.env.WORKER_URL;
const ADMIN_PWD = process.env.ADMIN_PWD;

async function run() {
    console.log("🚀 开始向 Worker 请求 SaaS 任务配置...");
    
    // 1. 去你的面板拿所有的账号和轮询配置
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

    // 2. 找到当前该跑哪个批次
    let currentIndex = config.currentIndex || 0;
    if (currentIndex >= config.batches.length) currentIndex = 0;
    const currentBatch = config.batches[currentIndex];
    
    console.log(`📦 本次执行第 ${currentIndex + 1} 批次，包含 ${currentBatch.length} 个任务`);

    // 3. 把原先在 Worker 里的创建和验证逻辑在这里跑，由于在 GitHub 里，多久都不会超时！
    for (const task of currentBatch) {
        const profile = profiles.find(p => p.name === task.profileName);
        if (!profile) continue;

        console.log(`🌐 正在处理: ${profile.name}, 数量: ${task.count}`);
        
        const successfulHosts = [];
        const pendingHosts = [];

        // 发起创建请求
        for (let i = 0; i < task.count; i++) {
            const host = profile.baseDomain.replace('xxx', Math.random().toString(36).substring(2, 8)); // 简化的域名生成
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

        // 在 GitHub 里死等证书下发（绝不会超时）
        console.log(`⏳ 开始验证证书，请耐心等待...`);
        for (const item of pendingHosts) {
            let active = false;
            for(let w=0; w<15; w++) { // 循环 15 次，每次等 10 秒
                await new Promise(r => setTimeout(r, 10000));
                const statusRes = await fetch(`${WORKER_URL}/api/saas/step_status`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, hostId: item.id })
                }).then(r => r.json()).catch(() => ({}));
                
                if (statusRes.active) {
                    active = true;
                    successfulHosts.push(item.host);
                    console.log(`✅ ${item.host} 验证成功`);
                    break;
                }
            }
        }

        // 4. 将成功的域名发还给 Worker 的“专属通道”
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

    // 5. 任务跑完，让 Worker 把指针推向下一批
    config.currentIndex = (currentIndex + 1) % config.batches.length;
    await fetch(`${WORKER_URL}/api/saas/auto_config`, {
        method: 'POST', headers,
        body: JSON.stringify({ password: ADMIN_PWD, config: config })
    });
    
    console.log("🎉 引擎运行完毕！");
}

run();
