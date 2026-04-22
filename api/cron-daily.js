import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

  try {
    const now = new Date();
    // 轉為台灣時間 UTC+8
    const taipeiTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const todayStr = taipeiTime.toISOString().split('T')[0];

    // 計算 30 天前的日期
    const thirtyDaysAgo = new Date(taipeiTime);
    thirtyDaysAgo.setDate(taipeiTime.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    // 1. 抓取「今天」的所有行程 (用於晨報)
    const { data: todayActivities } = await supabase
      .from('team_activities')
      .select('*')
      .eq('activity_date', todayStr)
      .order('start_time', { ascending: true });

    // 2. 抓取「過去 30 天內」的所有重要活動 (用於緊迫盯人追蹤)
    const { data: recentActivities } = await supabase
      .from('team_activities')
      .select('*')
      .gte('activity_date', thirtyDaysAgoStr)
      .lt('activity_date', todayStr) // 不含今天
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

      // ================= B. 🎯 30 天漏斗追蹤系統 =================
      const userActs = (recentActivities || []).filter(a => a.emp_id === user.emp_id);
      
      const clientsWithProposal = new Set();
      const clientsSigned = new Set();
      const clientsWithRecruit = new Set();
      const clientsRecruitTerminal = new Set(); // 已結案的增員名單

      // 分類該夥伴過去 30 天的所有行為
      userActs.forEach(a => {
        if (a.activity_type === '談建議書') clientsWithProposal.add(a.client_name);
        if (a.activity_type === '簽約') clientsSigned.add(a.client_name);
        if (a.activity_type === '增員面談') clientsWithRecruit.add(a.client_name);
        // 如果按過「已增加」或「不增加」，就列入結案名單，不再吵他
        if (a.activity_type === '增員追蹤' && ['已增加臨時帳號', '確認不增加'].includes(a.notes)) {
          clientsRecruitTerminal.add(a.client_name);
        }
      });

      // 1. 銷售追蹤：有談建議書，但還沒簽約的，天天提醒！
      const salesReminders = [...clientsWithProposal].filter(c => !clientsSigned.has(c));
      salesReminders.forEach(clientName => {
         lineMessages.push({
            type: 'text',
            text: `📊 【黃金促約提醒】\n\n您近期（30天內）曾向「${clientName}」談過建議書。\n\n系統尚未偵測到簽約紀錄，請記得持續追蹤、把握促約黃金期喔！💪`
         });
      });

      // 2. 增員追蹤：有面談過，且尚未選擇「結案狀態」的，天天提醒！
      const recruitReminders = [...clientsWithRecruit].filter(c => !clientsRecruitTerminal.has(c));
      recruitReminders.forEach(clientName => {
         lineMessages.push({
            type: "template",
            altText: `增員追蹤提醒：關於 ${clientName}`,
            template: {
              type: "buttons",
              title: "🤝 增員追蹤提醒",
              text: `您近期曾與「${clientName}」進行過增員面談，請問目前進度為何？`,
              actions: [
                { type: "message", label: "✅ 已增加臨時帳號", text: `更新進度：${clientName} 已增加臨時帳號` },
                { type: "message", label: "❌ 確認不增加", text: `更新進度：${clientName} 確認不增加` },
                { type: "message", label: "🔄 繼續追蹤", text: `更新進度：${clientName} 需要繼續追蹤` }
              ]
            }
         });
      });

      // ================= 發送推播 =================
      if (lineMessages.length > 0) {
        // LINE 限制一次最多發送 5 個對話泡泡，超過要分開寄送
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

    res.status(200).send(`✅ 自動巡邏完成！共發送了 ${pushCount} 位夥伴的晨報與追蹤。`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Cron Job 執行失敗');
  }
}
