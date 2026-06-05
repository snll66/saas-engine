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
        
        // 1. 🧹 清理旧资源
        await tg.log(`🗑️ 正在抹除旧域名与云端残留...`);
        try {
            await fetch(`${WORKER_URL}/api/saas/cleanup`, {
                method: 'POST', headers,
                body: JSON.stringify({ profileName: profile.name, baseDomain: profile.baseDomain, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, snippetRule: profile.snippetRule || '' })
            });
            await tg.log(`✅ 废弃资产清理完毕。`);
        } catch (e) {}

        await tg.log(`👁️ <b>目标代号: ${profile.name}</b> (分配 ${task.count} 个动态掩码)`);
        
        // 2. ⚡ 并发创建主机名
        const pendingHosts = [];
        for (let i = 0; i < task.count; i++) {
            const host = generateHostPattern(profile.domainPattern, profile.baseDomain); 
            const mask = maskDomain(host, profile.baseDomain); 
            await tg.log(`▶ [身份伪造 ${i+1}/${task.count}] 幽灵 ${mask} 生成中...`);
            
            const createRes = await fetch(`${WORKER_URL}/api/saas/step_create`, {
                method: 'POST', headers,
                body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostname: host })
            }).then(r => r.json()).catch(() => ({}));

            if (createRes.success) pendingHosts.push({ id: createRes.hostId, host: host, mask: mask, index: i+1 });
        }

        // 3. ⚡ 核心修复：并发下发初始 TXT 写入指令 (绝不再干等)
        if (pendingHosts.length > 0) {
            await tg.log(`\n⏳ 并发下发 TXT 注入指令，等待全网解析...`);
            for (const item of pendingHosts) {
                // 异步触发，不阻塞
                fetch(`${WORKER_URL}/api/saas/step_ssl`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostId: item.id })
                }).catch(() => {});
            }
        }

        // 4. 🎯 并发轮询与【精准定时补发】
        let activeHosts = [];
        // 循环 20 次，每次 15 秒，共计 5 分钟
        for (let w = 1; w <= 20; w++) { 
            await new Promise(r => setTimeout(r, 15000)); 
            
            for (let item of pendingHosts) {
                if (activeHosts.includes(item.host)) continue; // 活了就跳过，不浪费性能

                // 查询真实状态
                const statusRes = await fetch(`${WORKER_URL}/api/saas/step_status`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, hostId: item.id })
                }).then(r => r.json()).catch(() => ({ active: false }));

                if (statusRes.active) {
                    activeHosts.push(item.host);
                    await tg.log(` ✅ [${item.index}] 幽灵 ${item.mask} 潜行成功`);
                } else {
                    // 🎯 到了第 6 次(90秒)和第 12 次(180秒)，如果还没活，才触发精准单点修复
                    if (w === 6 || w === 12) {
                        const retryNum = w === 6 ? 1 : 2;
                        await tg.log(`🔄 [${item.index}] ${item.mask} 激活动力不足，触发单点精准 TXT 补发 (第 ${retryNum} 次)...`);
                        // 异步补发，不阻塞其他域名的查询
                        fetch(`${WORKER_URL}/api/saas/step_ssl`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostId: item.id })
                        }).catch(() => {});
                    }
                }
            }
            // 如果全都成功了，提前结束 5 分钟的苦等！
            if (activeHosts.length === pendingHosts.length) break;
        }

        // 5. 同步至面板
        if (activeHosts.length > 0) {
            let successCount = 0;
            await tg.log(`\n🔗 同步中枢路由...`);
            for (const host of activeHosts) {
                const syncRes = await fetch(`${WORKER_URL}/api/saas/sync_domain`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ profileName: profile.name, baseDomain: profile.baseDomain, hostname: host })
                }).then(r => r.json()).catch(()=>({}));
                if (syncRes.success) successCount++;
            }
            await tg.log(`🎉 <b>成功下发 ${successCount} 个免杀隐蔽节点</b>`);
        } else {
            await tg.log(`⚠️ <b>本次轮询未产生可用节点，已转入休眠。</b>`);
        }
        await tg.log(`\n🏁 <b>幽灵行动结束，切断所有外部连接。</b>`);
    }

    config.currentIndex = (currentIndex + 1) % config.batches.length;
    await fetch(`${WORKER_URL}/api/saas/auto_config`, { method: 'POST', headers, body: JSON.stringify({ password: ADMIN_PWD, config: config }) });
}

run();
