import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { action, credentials, payload } = req.body;
  if (!credentials || !credentials.empId || !credentials.password) {
    return res.status(401).json({ error: '缺少驗證憑證' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: user, error: authErr } = await supabase
    .from('team_users')
    .select('*')
    .eq('emp_id', credentials.empId)
    .eq('password', credentials.password)
    .single();

  if (authErr || !user) return res.status(401).json({ error: '帳號或密碼錯誤' });
  if (user.is_active === false) return res.status(403).json({ error: '帳號已被停權' });

  // Server-side 權限判定基準
  const isSuperAdmin = user.role === 'admin';
  const targetEmpId = isSuperAdmin && payload.viewingEmpId && payload.viewingEmpId !== 'ALL' 
                      ? payload.viewingEmpId 
                      : user.emp_id;

  try {
    switch (action) {
      case 'login': return res.status(200).json({ ...user, calendar_token: createHmac('sha256', SUPABASE_KEY).update(String(user.emp_id)).digest('hex') });
      case 'get_team':
        if (!isSuperAdmin) return res.status(403).json({ error: '無權限' });
        const { data: team } = await supabase.from('team_users').select('emp_id, name, is_active, role');
        return res.status(200).json(team);
      case 'update_password':
        await supabase.from('team_users').update({ password: payload.newPassword }).eq('emp_id', user.emp_id);
        return res.status(200).json({ ok: true });

      // ================= 6.2 CRM 核心 API =================
      case 'load_crm':
        // 權限隔離：一般業務永遠只能撈自己的 emp_id
        let cQuery = supabase.from('team_customers').select('*').order('last_contact_date', { ascending: false });
        let logQuery = supabase.from('team_contacts').select('*').order('contact_date', { ascending: false });
        
        if (!isSuperAdmin || payload.viewingEmpId !== 'ALL') {
           cQuery = cQuery.eq('emp_id', targetEmpId);
           logQuery = logQuery.eq('emp_id', targetEmpId);
        }
        
        const [cRes, lRes] = await Promise.all([cQuery, logQuery]);
        return res.status(200).json({ customers: cRes.data || [], contacts: lRes.data || [] });

      case 'save_customer': {
        const customerData = payload.customerData || {};
        if (!customerData.id) delete customerData.id;
        let existingCustomer = null;
        if (customerData.id) {
          const { data, error } = await supabase.from('team_customers').select('id, emp_id').eq('id', customerData.id).maybeSingle();
          if (error) throw new Error(error.message);
          existingCustomer = data;
          if (!existingCustomer) return res.status(404).json({ error: '找不到客戶資料' });
          if (!isSuperAdmin && existingCustomer.emp_id !== user.emp_id) return res.status(403).json({ error: '無權限修改其他業務員的客戶' });
        }
        let ownerEmpId = existingCustomer ? existingCustomer.emp_id : targetEmpId;
        if (!existingCustomer && isSuperAdmin && payload.ownerEmpId && payload.ownerEmpId !== 'ALL') {
          ownerEmpId = payload.ownerEmpId;
          const { data: owner, error } = await supabase.from('team_users').select('emp_id').eq('emp_id', ownerEmpId).maybeSingle();
          if (error) throw new Error(error.message);
          if (!owner) return res.status(400).json({ error: '名單負責人不存在' });
        }
        const { data: savedCust, error: cErr } = await supabase.from('team_customers').upsert({ ...customerData, emp_id: ownerEmpId }).select().single();
        if (cErr) throw new Error(cErr.message);
        return res.status(200).json(savedCust);
      }

      case 'save_contact': {
        const contactData = payload.contactData || {};
        if (!contactData.customer_id) return res.status(400).json({ error: '缺少客戶資料' });
        const { data: customer, error: customerErr } = await supabase.from('team_customers').select('id, emp_id').eq('id', contactData.customer_id).maybeSingle();
        if (customerErr) throw new Error(customerErr.message);
        if (!customer) return res.status(404).json({ error: '找不到客戶' });
        if (!isSuperAdmin && customer.emp_id !== user.emp_id) return res.status(403).json({ error: '無權限存取其他業務員的客戶' });
        const contactPayload = { ...contactData, emp_id: customer.emp_id };
        if (contactPayload.id) {
          const { data: existingContact, error } = await supabase.from('team_contacts').select('id, emp_id').eq('id', contactPayload.id).maybeSingle();
          if (error) throw new Error(error.message);
          if (existingContact && existingContact.emp_id !== user.emp_id && !isSuperAdmin) return res.status(403).json({ error: '無權限修改其他業務員的定聯紀錄' });
        }
        const customerUpdates = { last_contact_date: contactPayload.contact_date, next_contact_date: contactPayload.next_contact_date || null };
        if (payload.customerData && Object.prototype.hasOwnProperty.call(payload.customerData, 'phone')) customerUpdates.phone = String(payload.customerData.phone || '').trim();
        const { error: updateErr } = await supabase.from('team_customers').update(customerUpdates).eq('id', customer.id).eq('emp_id', customer.emp_id);
        if (updateErr) throw new Error(updateErr.message);
        const { error: contactErr } = await supabase.from('team_contacts').upsert(contactPayload);
        if (contactErr) throw new Error(contactErr.message);
        return res.status(200).json({ ok: true });
      }

      // ================= 6.1 既有 API (無損相容) =================
      case 'load_activities':
        let q = supabase.from('team_activities').select('*');
        if (!isSuperAdmin || payload.viewingEmpId !== 'ALL') { q = q.eq('emp_id', targetEmpId); }
        const { data: acts } = await q;
        return res.status(200).json(acts);

      case 'load_org':
        const { data: orgList } = await supabase.from('activities').select('notes').eq('client_name', 'APP_VAULT_V1').limit(1);
        return res.status(200).json(orgList && orgList.length > 0 ? orgList[0] : null);

      case 'save_org':
        if (!isSuperAdmin) return res.status(403).json({ error: '無權限' });
        const { data: updatedRows } = await supabase.from('activities').update({ notes: payload.notes }).eq('client_name', 'APP_VAULT_V1').select();
        if (!updatedRows || updatedRows.length === 0) {
           await supabase.from('activities').insert({ activity_date: '2099-12-31', start_time: '00:00', activity_type: 'VAULT', client_name: 'APP_VAULT_V1', notes: payload.notes });
        }
        return res.status(200).json({ ok: true });

      case 'save_activity':
        const activity = payload.activityPayload;
        if (!activity) return res.status(400).json({ error: '缺少行程資料' });
        let existingActivity = null;
        if (activity.id) {
          const { data, error } = await supabase.from('team_activities').select('id, emp_id').eq('id', activity.id).maybeSingle();
          if (error) throw new Error(error.message);
          existingActivity = data;
          if (existingActivity && !isSuperAdmin && existingActivity.emp_id !== user.emp_id) return res.status(403).json({ error: '無權限修改其他業務員的行程' });
        }
        activity.emp_id = existingActivity ? existingActivity.emp_id : targetEmpId;
        
        // 🌟 CRM 雙向連動引擎：自動建檔與綁定
        if (payload.activityPayload.client_name && payload.activityPayload.activity_type !== '準增員名單') {
            let custId = payload.activityPayload.customer_id;
            if (!custId) {
                // 利用姓名反查
                const { data: existCust } = await supabase.from('team_customers')
                    .select('id').eq('emp_id', targetEmpId).eq('name', payload.activityPayload.client_name).single();
                if (existCust) {
                    custId = existCust.id;
                } else {
                    // 自動建立潛在客戶
                    const { data: newCust } = await supabase.from('team_customers')
                        .insert({ emp_id: targetEmpId, name: payload.activityPayload.client_name, source: '339行程自動建立' })
                        .select('id').single();
                    if (newCust) custId = newCust.id;
                }
            }
            if (custId) {
                payload.activityPayload.customer_id = custId;
                // 更新客戶最後互動日
                await supabase.from('team_customers').update({ 
                    last_contact_date: payload.activityPayload.activity_date 
                }).eq('id', custId).eq('emp_id', activity.emp_id);
            }
        }
        
        const { error: saveActErr } = await supabase.from('team_activities').upsert(payload.activityPayload);
        if (saveActErr) throw new Error(saveActErr.message);
        return res.status(200).json({ ok: true });

      case 'delete_activity':
        let delQ = supabase.from('team_activities').delete().eq('id', payload.id);
        if (!isSuperAdmin) delQ = delQ.eq('emp_id', targetEmpId);
        await delQ; return res.status(200).json({ ok: true });

      case 'create_user':
        if (!isSuperAdmin) return res.status(403).json({ error: '無權限' });
        await supabase.from('team_users').insert({ emp_id: payload.empId, password: payload.password, name: payload.name, role: 'agent' });
        return res.status(200).json({ ok: true });

      case 'update_user':
        if (!isSuperAdmin) return res.status(403).json({ error: '無權限' });
        await supabase.from('team_users').update(payload.updateData).eq('emp_id', payload.empId);
        return res.status(200).json({ ok: true });

      case 'delete_user':
        if (!isSuperAdmin) return res.status(403).json({ error: '無權限' });
        await supabase.from('team_activities').delete().eq('emp_id', payload.empId);
        await supabase.from('team_customers').delete().eq('emp_id', payload.empId);
        await supabase.from('team_contacts').delete().eq('emp_id', payload.empId);
        await supabase.from('team_users').delete().eq('emp_id', payload.empId);
        return res.status(200).json({ ok: true });

      default: return res.status(400).json({ error: 'Invalid Action' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
