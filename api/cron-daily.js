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

    // 1. 抓取「今天」的所有行程 (晨報用)
    const { data: todayActivities } = await supabase
      .from('team_activities')
      .select('*')
      .eq('activity_date', todayStr)
      .order('start_time', { ascending: true });

    // 2. 抓取「過去 30 天內(含今天)」的所有活動 (追蹤用)
    // 🌟 這裡修正了：不再用 .lt(today)，改用包含今天的資料，解決重複提醒問題
    const { data: recentActivities } = await supabase
      .from('team_activities')
      .select('*')
      .gte('activity_date', thirtyDaysAgoStr)
      .lte('activity_date', todayStr) 
      .in('activity_type', ['談建議書', '簽約', '增員面談', '增員追蹤']);

    const { data: users } = await supabase.from('team_users').select('emp_id, line_user_id, name');

    let pushCount = 0;

    for (const user of users) {
      if (!user.line_user_id) continue;

      let lineMessages = [];

      // ================= A. 🌅 今日行程晨報 =================
      const userTodayActs = (todayActivities || []).filter(a => a.emp_id === user.emp_id);
      if (userTodayActs.length > 0) {
        let scheduleText = `🌅 【今日行程晨報】\n\n${user.name} 早安！\n這是您今天的 339 戰情行程：\n`;
        userTodayActs.forEach(act => {
          scheduleText += `\n⏰ ${act.start_time}\n📌 ${act.activity_type} - ${act.client_name}`;
          if (act.notes) scheduleText += `\n📝 ${act.notes}`;
          scheduleText += `\n`;
        });
        scheduleText += `\n祝您今天拜訪順利、業績長紅！🔥`;
        lineMessages.push({ type: 'text', text: scheduleText });
      }

      // ================= B. 🎯 30 天自動漏斗追蹤 =================
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

      // 1. 銷售追蹤
      const salesReminders = [...clientsWithProposal].filter(c => !clientsSigned.has(c));
      salesReminders.forEach(clientName => {
         lineMessages.push({
            type: 'text',
            text: `📊 【銷售追蹤提醒】\n\n客戶「${clientName}」\n您近期曾與其談過建議書，系統目前尚未偵測到簽約紀錄。\n\n請記得持續促成喔！💪`
         });
      });

      // 2. 增員追蹤
      const recruitReminders = [...clientsWithRecruit].filter(c => !clientsRecruitTerminal.has(c));
      recruitReminders.forEach(clientName => {
         lineMessages.push({
            type: "template",
            altText: `增員追蹤提醒：關於 ${clientName}`,
            template: {
              type: "buttons",
              title: "🤝 增員追蹤提醒",
              text: `關於「${clientName}」的增員面談，請問目前最新進度為何？`,
              actions: [
                { type: "message", label: "✅ 已增加臨時帳號", text: `更新進度：${clientName} 已增加臨時帳號` },
                { type: "message", label: "❌ 確認不增加", text: `更新進度：${clientName} 確認不增加` },
                { type: "message", label: "🔄 繼續追蹤", text: `更新進度：${clientName} 需要繼續追蹤` }
              ]
            }
         });
      });

      if (lineMessages.length > 0) {
        for (let i = 0; i < lineMessages.length; i += 5) {
          const chunk = lineMessages.slice(i, i + 5);
          await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_ACCESS_TOKEN}` },
            body: JSON.stringify({ to: user.line_user_id, messages: chunk })
          });
        }
        pushCount++;
      }
    }

    res.status(200).send(`✅ 排程測試完成！已成功排除結案名單並處理了 ${pushCount} 位夥伴。`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Cron Job 執行失敗');
  }
}
