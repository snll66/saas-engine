const WORKER_URL = process.env.WORKER_URL;
const ADMIN_PWD = process.env.ADMIN_PWD;

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
    console.log("🚀 开始向 Worker 请求 SaaS 任务配置...");
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
        await tg.log(`\n👁️ <b>目标代号: ${profile.name}</b> (分配 ${task.count} 个动态掩码)`);
        
        await tg.log(`🗑️ 正在销毁追踪痕迹与废弃路由...`);
        try {
            await fetch(`${WORKER_URL}/api/saas/cleanup`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    profileName: profile.name, baseDomain: profile.baseDomain, apiToken: profile.apiToken, 
                    saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, snippetRule: profile.snippetRule || ''
                })
            });
            await tg.log(`✅ 痕迹焚毁完毕。`);
        } catch (e) {
            await tg.log(`❌ 销毁异常跳过: ${e.message}`);
        }

        const successfulHosts = [];
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

        if (pendingHosts.length > 0) {
            await tg.log(`\n⏳ 执行 ${pendingHosts.length} 层反侦察验证...`);
            
            for (const item of pendingHosts) {
                let sslReady = false;
                
                // 第一步：向 CF 索要 TXT 验证记录并写入
                for(let w=0; w<18; w++) { 
                    await new Promise(r => setTimeout(r, 10000));
                    const sslRes = await fetch(`${WORKER_URL}/api/saas/step_ssl`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostId: item.id })
                    }).then(r => r.json()).catch(() => ({}));
                    
                    if (sslRes.ready) { 
                        sslReady = true; 
                        console.log(`[${item.index}] TXT 记录下发且注入指令已发送`);
                        break; 
                    }
                }

                if (!sslReady) {
                    await tg.log(`❌ [${item.index}] 幽灵 ${item.mask} 掩码下发失败，目标舍弃`);
                    continue;
                }

                // 第二步：循环等待 CF 验证生效，并加入【双重补发校验】机制
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
                        break; 
                    }

                    // 💡 防阻断核心：如果等了 100 秒（10次循环）还没激活，触发强制补发 TXT 记录
                    if (w === 10 || w === 18) {
                        console.log(`[${item.index}] 激活迟滞，触发底层 TXT 强制补发机制 (第 ${w} 次循环)`);
                        await fetch(`${WORKER_URL}/api/saas/step_ssl`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostId: item.id })
                        }).catch(() => {});
                    }
                }

                if (active) {
                    await tg.log(` ✅ [${item.index}] 幽灵 ${item.mask} 潜行成功`);
                } else {
                    await tg.log(` ⚠️ [${item.index}] 幽灵 ${item.mask} 遭遇深层干扰 (退入后台轮询)`);
                    // 即使本次没激活成功，只要 TXT 记录写进去了，CF 迟早会发证。先写入面板以防丢失。
                    successfulHosts.push(item.host);
                }
            }
        }

        if (successfulHosts.length > 0) {
            await tg.log(`\n🔗 正在将新身份注入总控路由...`);
            let successCount = 0;
            
            for (const host of successfulHosts) {
                try {
                    const syncRes = await fetch(`${WORKER_URL}/api/saas/sync_domain`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ profileName: profile.name, baseDomain: profile.baseDomain, hostname: host })
                    }).then(r => r.json());
                    if (syncRes.success) successCount++;
                } catch(e) {}
            }
            
            if(successCount > 0) {
                await tg.log(`🎉 <b>成功下发 ${successCount} 个免杀隐蔽节点</b>`);
            } else {
                await tg.log(`⚠️ 路由注入失败，请检查配置参数`);
            }
        }
        await tg.log(`\n🏁 <b>幽灵行动结束，切断所有外部连接。</b>`);
    }

    config.currentIndex = (currentIndex + 1) % config.batches.length;
    await fetch(`${WORKER_URL}/api/saas/auto_config`, {
        method: 'POST', headers,
        body: JSON.stringify({ password: ADMIN_PWD, config: config })
    });
}

run();
