const WORKER_URL = process.env.WORKER_URL;
const ADMIN_PWD = process.env.ADMIN_PWD;

// 🤖 封装一个专属的 TG 直播播报员
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

// 🛡️ 智能打码：永远保留首字母和主域名，中间全打星号
const maskDomain = (host, base) => {
    if (!host || !base || !host.endsWith(base)) return host;
    // 提取出生成的前缀部分 (比如 host 是 t1.a.b.test.com，base 是 test.com，prefix 就是 t1.a.b.)
    const prefix = host.substring(0, host.length - base.length); 
    if (!prefix) return base;
    
    // 取出首字母
    const firstChar = prefix.charAt(0);
    // 剩下的前缀全部替换为 * (保留点号)
    const maskedPrefix = firstChar + prefix.substring(1).replace(/[a-zA-Z0-9]/g, '*');
    
    return maskedPrefix + base;
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
        await tg.log(`⏰ <b>定时轮询批次 [${currentIndex + 1}/${config.batches.length}] 启动</b>`);
        await tg.log(`\n🌐 <b>处理配置: ${profile.name}</b> (生成 ${task.count} 个)`);
        
        await tg.log(`🧹 正在清理上一批的旧域名与云端残留...`);
        try {
            await fetch(`${WORKER_URL}/api/saas/cleanup`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    profileName: profile.name, baseDomain: profile.baseDomain, apiToken: profile.apiToken, 
                    saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, snippetRule: profile.snippetRule || ''
                })
            });
            await tg.log(`✅ 清理完毕。`);
        } catch (e) {
            await tg.log(`❌ 清理异常跳过: ${e.message}`);
        }

        const successfulHosts = [];
        const pendingHosts = [];

        for (let i = 0; i < task.count; i++) {
            const host = generateHostPattern(profile.domainPattern, profile.baseDomain); 
            // 传入完整域名和主域名进行打码
            const mask = maskDomain(host, profile.baseDomain); 
            
            await tg.log(`▶ [请求 ${i+1}/${task.count}] ${mask}`);
            
            const createRes = await fetch(`${WORKER_URL}/api/saas/step_create`, {
                method: 'POST', headers,
                body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostname: host })
            }).then(r => r.json()).catch(() => ({}));

            if (createRes.success) pendingHosts.push({ id: createRes.hostId, host: host, mask: mask, index: i+1 });
        }

        if (pendingHosts.length > 0) {
            await tg.log(`\n⏳ 并发验证 ${pendingHosts.length} 个证书...`);
            
            for (const item of pendingHosts) {
                let sslReady = false;
                for(let w=0; w<6; w++) { 
                    await new Promise(r => setTimeout(r, 10000));
                    const sslRes = await fetch(`${WORKER_URL}/api/saas/step_ssl`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ profileName: profile.name, apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, dnsZoneId: profile.dnsZoneId, hostId: item.id })
                    }).then(r => r.json()).catch(() => ({}));
                    if (sslRes.ready) { sslReady = true; break; }
                }

                if (!sslReady) {
                    await tg.log(`❌ [${item.index}] ${item.mask} 获取超时`);
                    continue;
                }

                let active = false;
                for(let w=0; w<24; w++) { 
                    await new Promise(r => setTimeout(r, 10000));
                    const statusRes = await fetch(`${WORKER_URL}/api/saas/step_status`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ apiToken: profile.apiToken, saasZoneId: profile.saasZoneId, hostId: item.id })
                    }).then(r => r.json()).catch(() => ({}));
                    if (statusRes.active) { active = true; successfulHosts.push(item.host); break; }
                }

                if (active) {
                    await tg.log(` ✅ [${item.index}] ${item.mask} 生效`);
                } else {
                    await tg.log(` ⚠️ [${item.index}] ${item.mask} 激活延时`);
                    successfulHosts.push(item.host);
                }
            }
        }

        if (successfulHosts.length > 0) {
            await tg.log(`\n🔗 正在同步至面板...`);
            let successCount = 0;
            
            // 修复点：抛弃之前的独立接口，改用原生面板自带的同步接口，确保 100% 写入成功！
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
                await tg.log(`🎉 <b>成功写入 ${successCount} 个新节点</b>`);
            } else {
                await tg.log(`⚠️ 面板写入失败，请检查名称映射`);
            }
        }
        await tg.log(`\n🏁 <b>本批次执行完毕</b>`);
    }

    config.currentIndex = (currentIndex + 1) % config.batches.length;
    await fetch(`${WORKER_URL}/api/saas/auto_config`, {
        method: 'POST', headers,
        body: JSON.stringify({ password: ADMIN_PWD, config: config })
    });
}

run();
