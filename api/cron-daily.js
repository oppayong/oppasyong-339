import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

  try {
    // 🌟 校正為台灣時間 (UTC+8)
    const now = new Date();
    const taipeiTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const todayStr = taipeiTime.toISOString().split('T')[0];

    // 10 天前的日期
    const tenDaysAgoDate = new Date(taipeiTime);
    tenDaysAgoDate.setDate(taipeiTime.getDate() - 10);
    const targetDateStr = tenDaysAgoDate.toISOString().split('T')[0];

    // 1. 抓取 10 天前需要追蹤的「談建議書、增員面談」
    const { data: targetActivities } = await supabase
      .from('team_activities')
      .select('*')
      .eq('activity_date', targetDateStr)
      .in('activity_type', ['談建議書', '增員面談']);

    // 2. 抓取「今天」的所有行程
    const { data: todayActivities } = await supabase
      .from('team_activities')
      .select('*')
      .eq('activity_date', todayStr)
      .order('start_time', { ascending: true }); // 依照時間排序

    // 3. 抓取所有用戶資料
    const { data: users } = await supabase.from('team_users').select('emp_id, line_user_id, name');

    let pushCount = 0;

    // 4. 針對每位夥伴，整理屬於他的「今日行程」與「10天追蹤」
    for (const user of users) {
      if (!user.line_user_id) continue;

      let lineMessages = [];

      // ================= A. 今日行程預告 =================
      const userTodayActs = (todayActivities || []).filter(a => a.emp_id === user.emp_id);
      if (userTodayActs.length > 0) {
        let scheduleText = `🌅 【今日行程預告】\n\n${user.name} 早安！\n這是您今天的 339 行程：\n`;
        
        userTodayActs.forEach(act => {
          scheduleText += `\n⏰ ${act.start_time}\n📌 ${act.activity_type} - ${act.client_name}`;
          if (act.notes) scheduleText += `\n📝 ${act.notes}`;
          scheduleText += `\n`;
        });
        
        scheduleText += `\n祝您今天拜訪順利、業績長紅！🔥`;
        lineMessages.push({ type: 'text', text: scheduleText });
      }

      // ================= B. 10 天前追蹤提醒 =================
      const user10DaysActs = (targetActivities || []).filter(a => a.emp_id === user.emp_id);
      for (const act of user10DaysActs) {
        if (act.activity_type === '談建議書') {
          const { data: signedCheck } = await supabase
            .from('team_activities')
            .select('id')
            .eq('emp_id', act.emp_id)
            .eq('client_name', act.client_name)
            .eq('activity_type', '簽約')
            .gte('activity_date', targetDateStr)
            .limit(1);

          if (!signedCheck || signedCheck.length === 0) {
            lineMessages.push({
              type: 'text',
              text: `📊 【黃金促約提醒】\n\n您於 10 天前向客戶「${act.client_name}」談過建議書。\n\n系統尚未偵測到簽約紀錄，請記得主動關心回訪喔！💪`
            });
          }
        }

        if (act.activity_type === '增員面談') {
          lineMessages.push({
            type: "template",
            altText: `增員追蹤提醒：關於 ${act.client_name}`,
            template: {
              type: "buttons",
              title: "🤝 增員追蹤提醒",
              text: `您於 10 天前與「${act.client_name}」進行過增員面談，請問目前進度為何？`,
              actions: [
                { type: "message", label: "✅ 已增加臨時帳號", text: `更新進度：${act.client_name} 已增加臨時帳號` },
                { type: "message", label: "❌ 確認不增加", text: `更新進度：${act.client_name} 確認不增加` },
                { type: "message", label: "🔄 繼續追蹤", text: `更新進度：${act.client_name} 需要繼續追蹤` }
              ]
            }
          });
        }
      }

      // ================= 發送該夥伴的所有訊息 =================
      if (lineMessages.length > 0) {
        // LINE Push API 限制一次最多發送 5 則訊息，做個防呆切塊
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

    res.status(200).send(`✅ 自動巡邏完成！共發送了 ${pushCount} 位夥伴的今日行程與追蹤提醒。`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Cron Job 執行失敗');
  }
}
