import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 現在的 key 變成輸入員編，例如 ?key=200106583
  const empId = req.query.key;
  if (!empId) return res.status(401).send('請在網址後方加上 ?key=您的員編');

  const SUPABASE_URL = 'https://mezculqrqxwlmfxgrcru.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lemN1bHFycXh3bG1meGdyY3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjU0NjUsImV4cCI6MjA5MjI0MTQ2NX0.U8aAJs5wi2_wPNWeNRrucQH7gPH4rEJx9KfTgHljVZI';
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // 從全新企業級資料庫抓取該員編的所有行程
    const { data: activities, error } = await supabase
      .from('team_activities')
      .select('*')
      .eq('emp_id', empId);

    if (error || !activities || activities.length === 0) {
      return res.status(404).send('找不到該員編的行程資料');
    }

    // 轉換成 iPhone 支援的 iCalendar 格式
    let icsString = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//RongAn//339WarRoom//TW\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:南山339戰情室\r\nX-WR-TIMEZONE:Asia/Taipei\r\n`;

    activities.forEach((act) => {
      const datePart = act.activity_date.replace(/-/g, ''); // YYYYMMDD
      const startStr = act.start_time.replace(':', '') + '00'; // HHMMSS
      let hour = parseInt(act.start_time.split(':')[0]) + 1; // 預設 1 小時長度
      const endStr = `${hour.toString().padStart(2, '0')}0000`;
      
      icsString += `BEGIN:VEVENT\r\nUID:${act.id}@rongan\r\nDTSTAMP:${datePart}T${startStr}Z\r\n`;
      icsString += `DTSTART;TZID=Asia/Taipei:${datePart}T${startStr}\r\n`;
      icsString += `DTEND;TZID=Asia/Taipei:${datePart}T${endStr}\r\n`;
      icsString += `SUMMARY:[${act.activity_type}] ${act.client_name}\r\n`;
      icsString += `DESCRIPTION:${act.notes || '無備註'}\r\n`;
      icsString += `END:VEVENT\r\n`;
    });

    icsString += `END:VCALENDAR`;

    // 設定回傳標頭，讓 iPhone 知道這是一個行事曆檔案
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rongan_339_${empId}.ics"`);
    res.status(200).send(icsString);

  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
}
