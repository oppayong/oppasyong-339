import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const empId = req.query.key;
  if (!empId) return res.status(401).send('請在網址後方加上 ?key=您的員編');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    const { data: activities, error } = await supabase
      .from('team_activities')
      .select('*')
      .eq('emp_id', empId);

    if (error || !activities || activities.length === 0) {
      return res.status(404).send('找不到該員編的行程資料');
    }

    let icsString = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//RongAn//339WarRoom//TW\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:南山339戰情室\r\nX-WR-TIMEZONE:Asia/Taipei\r\n`;

    activities.forEach((act) => {
      const datePart = act.activity_date.replace(/-/g, ''); 
      const startStr = act.start_time.replace(':', '') + '00'; 
      let hour = parseInt(act.start_time.split(':')[0]) + 1; 
      const endStr = `${hour.toString().padStart(2, '0')}0000`;
      
      let eventPrefix = '';
      if (['約訪', '面談', '談建議書', '簽約', '客戶服務'].includes(act.activity_type)) {
        eventPrefix = '🔵 [銷售]';
      } else if (['增員活動', '增員約訪', '增員面談'].includes(act.activity_type)) {
        eventPrefix = '🟢 [增員]';
      } else {
        eventPrefix = '🟠 [其他]';
      }
      
      icsString += `BEGIN:VEVENT\r\nUID:${act.id}@rongan\r\nDTSTAMP:${datePart}T${startStr}Z\r\n`;
      icsString += `DTSTART;TZID=Asia/Taipei:${datePart}T${startStr}\r\n`;
      icsString += `DTEND;TZID=Asia/Taipei:${datePart}T${endStr}\r\n`;
      icsString += `SUMMARY:${eventPrefix} ${act.activity_type} - ${act.client_name}\r\n`;
      icsString += `DESCRIPTION:${act.notes || '無備註'}\r\n`;
      icsString += `END:VEVENT\r\n`;
    });
    icsString += `END:VCALENDAR`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rongan_339_${empId}.ics"`);
    res.status(200).send(icsString);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
}
