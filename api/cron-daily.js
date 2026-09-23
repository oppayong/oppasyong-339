import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

  try {
    const now = new Date();
    const taipeiTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const todayStr = taipeiTime.toISOString().split('T')[0];

    const thirtyDaysAgo = new Date(taipeiTime);
    thirtyDaysAgo.setDate(taipeiTime.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    // 1. 抓取 339 今日行程
    const { data: todayActivities } = await supabase.from('team_activities')
      .select('*').eq('activity_date', todayStr).order('start_time', { ascending: true });

    // 2. 抓取 30 天追蹤名單
    const { data: recentActivities } = await supabase.from('team_activities')
      .select('*').gte('activity_date', thirtyDaysAgoStr).lte('activity_date', todayStr) 
      .in('activity_type', ['談建議書', '簽約', '增員面談', '增員追蹤']);

    // 3. 🌟 抓取 CRM 定聯名單 (今日應聯絡 + 逾期)
    const { data: crmCustomers } = await supabase.from('team_customers')
      .select('emp_id, name, next_contact_date, level')
      .lte('next_contact_date', todayStr);

    const { data: users } = await supabase.from('team_users').select('emp_id, line_user_id, name');
    let pushCount = 0;

    for (const user of users) {
      if (!user.line_user_id) continue;
      let lineMessages = [];

      // ================= A. 🌅 CRM 今日業務晨報 =================
      let morningReport = `🌅 【鎔安組｜今日業務晨報】\n\n${user.name} 早安！\n`;
      
      const userTodayActs = (todayActivities || []).filter(a => a.emp_id === user.emp_id);
      if (userTodayActs.length > 0) {
        morningReport += `\n📅 [今日 339 行程]\n`;
        userTodayActs.forEach(act => { morningReport += `⏰ ${act.start_time} ${act.client_name}｜${act.activity_type}\n`; });
      }

      const userContacts = (crmCustomers || []).filter(c => c.emp_id === user.emp_id);
      const todayContacts = userContacts.filter(c => c.next_contact_date === todayStr);
      const overdueContacts = userContacts.filter(c => c.next_contact_date < todayStr);

      if (todayContacts.length > 0 || overdueContacts.length > 0) {
        morningReport += `\n📞 [CRM 定聯任務]\n`;
        if (todayContacts.length > 0) morningReport += `📌 今日需聯絡：${todayContacts.length} 位\n`;
        if (overdueContacts.length > 0) morningReport += `⚠️ 逾期未聯絡：${overdueContacts.length} 位\n`;
      }

      morningReport += `\n祝您今天拜訪順利、業績長紅！🔥`;
      
      if (userTodayActs.length > 0 || userContacts.length > 0) {
         lineMessages.push({ type: 'text', text: morningReport });
      }

      // ================= B. 🎯 30 天漏斗追蹤 (維持 6.1 邏輯) =================
      const userActs = (recentActivities || []).filter(a => a.emp_id === user.emp_id);
      const clientsWithProposal = new Set();
      const clientsSigned = new Set();
      const clientsWithRecruit = new Set();
      const clientsRecruitTerminal = new Set(); 

      userActs.forEach(a => {
        if (a.activity_type === '談建議書') clientsWithProposal.add(a.client_name);
        if (a.activity_type === '簽約') clientsSigned.add(a.client_name);
        if (a.activity_type === '增員面談') clientsWithRecruit.add(a.client_name);
        if (a.activity_type === '增員追蹤' && ['已增加臨時帳號', '確認不增加'].includes(a.notes)) {
          clientsRecruitTerminal.add(a.client_name);
        }
      });

      const salesReminders = [...clientsWithProposal].filter(c => !clientsSigned.has(c));
      salesReminders.forEach(cName => {
         lineMessages.push({ type: 'text', text: `📊 【銷售漏斗預警】\n\n客戶「${cName}」已於近期提案，尚未簽約，請安排今日定聯追蹤！💪` });
      });

      const recruitReminders = [...clientsWithRecruit].filter(c => !clientsRecruitTerminal.has(c));
      recruitReminders.forEach(cName => {
         lineMessages.push({
            type: "template", altText: `增員追蹤提醒：${cName}`,
            template: {
              type: "buttons", title: "🤝 增員漏斗追蹤", text: `「${cName}」增員面談後進度為何？`,
              actions: [
                { type: "message", label: "✅ 已增加臨時帳號", text: `更新進度：${cName} 已增加臨時帳號` },
                { type: "message", label: "❌ 確認不增加", text: `更新進度：${cName} 確認不增加` },
                { type: "message", label: "🔄 繼續追蹤", text: `更新進度：${cName} 需要繼續追蹤` }
              ]
            }
         });
      });

      if (lineMessages.length > 0) {
        for (let i = 0; i < lineMessages.length; i += 5) {
          const chunk = lineMessages.slice(i, i + 5);
          await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_ACCESS_TOKEN}` }, body: JSON.stringify({ to: user.line_user_id, messages: chunk })
          });
        }
        pushCount++;
      }
    }
    res.status(200).send(`✅ 排程完成！發送了 ${pushCount} 位夥伴的晨報。`);
  } catch (error) { res.status(500).send('Cron Job Error'); }
}
