import { createClient } from '@supabase/supabase-js';
import { defaultState } from './default-state.js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;

if(!url||!key) console.warn('Supabase env variables are missing.');

export const supabaseAdmin=createClient(url||'http://localhost',key||'missing',{
  auth:{persistSession:false,autoRefreshToken:false}
});

function assertResult(name,result){
  if(result?.error){
    const err=new Error(`${name}: ${result.error.message||'Supabase error'}`);
    err.cause=result.error;
    throw err;
  }
  return result?.data||[];
}

function accountRow(a){
  return {
    id:a.id,
    name:a.name||'Hesap',
    type:a.type||'wallet',
    owner_name:a.owner||null,
    bank_name:a.bankName||null,
    iban:a.iban||null,
    total_debt:Number(a.totalDebt||0),
    note:a.note||null,
    created_at:a.createdAt||new Date().toISOString(),
    payload:a
  };
}

function transactionRow(t){
  return {
    id:t.id,
    type:t.type||'unknown',
    account_id:t.accountId||null,
    from_account_id:t.fromAccountId||null,
    to_account_id:t.toAccountId||null,
    asset:t.asset||null,
    amount:Number(t.amount||0),
    purpose:t.purpose||null,
    transaction_date:t.date||new Date().toISOString().slice(0,10),
    created_by:t.createdBy||null,
    created_at:t.createdAt||new Date().toISOString(),
    payload:t
  };
}

function planRow(p){
  return {
    id:p.id,
    debt_account_id:p.debtAccountId,
    month:p.month,
    due_date:p.dueDate||null,
    created_at:p.createdAt||new Date().toISOString(),
    payload:p
  };
}

function claimRow(c){
  return {
    id:c.id,
    plan_id:c.planId||null,
    debt_account_id:c.debtAccountId||null,
    user_name:c.user||'',
    month:c.month||null,
    amount:Number(c.amount||0),
    payment_date:c.paymentDate||null,
    status:c.status||'pending',
    approved_by:c.approvedBy||null,
    approved_at:c.approvedAt||null,
    rejected_at:c.rejectedAt||null,
    created_at:c.createdAt||new Date().toISOString(),
    payload:c
  };
}

function notificationRow(n){
  return {
    id:n.id,
    target_user:n.targetUser||'',
    title:n.title||null,
    message:n.message||null,
    is_read:!!n.read,
    created_at:n.createdAt||new Date().toISOString(),
    payload:n
  };
}

async function seedCoreAccounts(existing=[]){
  const base=defaultState();
  const ids=new Set(existing.map(a=>a?.id));
  const missing=base.accounts.filter(a=>!ids.has(a.id));
  if(!missing.length)return existing;

  const result=await supabaseAdmin.from('kck_accounts').upsert(missing.map(accountRow),{onConflict:'id'});
  assertResult('kck_accounts seed',result);
  return [...existing,...missing];
}

export async function readState(){
  const [
    accountsRes,
    txRes,
    plansRes,
    claimsRes,
    notificationsRes,
    pricesRes,
    settingsRes
  ]=await Promise.all([
    supabaseAdmin.from('kck_accounts').select('*').order('created_at',{ascending:true}),
    supabaseAdmin.from('kck_transactions').select('*').order('created_at',{ascending:true}),
    supabaseAdmin.from('kck_debt_plans').select('*').order('created_at',{ascending:true}),
    supabaseAdmin.from('kck_payment_claims').select('*').order('created_at',{ascending:true}),
    supabaseAdmin.from('kck_notifications').select('*').order('created_at',{ascending:false}),
    supabaseAdmin.from('kck_prices').select('*').order('key',{ascending:true}),
    supabaseAdmin.from('kck_settings').select('*').eq('id','main').maybeSingle()
  ]);

  const accountRows=assertResult('kck_accounts',accountsRes);
  const txRows=assertResult('kck_transactions',txRes);
  const planRows=assertResult('kck_debt_plans',plansRes);
  const claimRows=assertResult('kck_payment_claims',claimsRes);
  const notificationRows=assertResult('kck_notifications',notificationsRes);
  const priceRows=assertResult('kck_prices',pricesRes);
  if(settingsRes?.error) throw new Error(`kck_settings: ${settingsRes.error.message||'Supabase error'}`);

  const base=defaultState();
  const loadedAccounts=accountRows.map(r=>r.payload||{
    id:r.id,name:r.name,type:r.type,owner:r.owner_name||'',bankName:r.bank_name||'',
    iban:r.iban||'',totalDebt:Number(r.total_debt||0),note:r.note||'',createdAt:r.created_at
  });
  const accounts=await seedCoreAccounts(loadedAccounts);

  const prices={...base.prices};
  const priceNames={...base.priceNames};
  for(const r of priceRows){
    prices[r.key]=Number(r.value||0);
    priceNames[r.key]=r.name||r.key;
  }

  return {
    version:7,
    accounts,
    transactions:txRows.map(r=>r.payload||{
      id:r.id,type:r.type,accountId:r.account_id,fromAccountId:r.from_account_id,toAccountId:r.to_account_id,
      asset:r.asset,amount:Number(r.amount||0),purpose:r.purpose,date:r.transaction_date,createdBy:r.created_by,createdAt:r.created_at
    }),
    debtPlans:planRows.map(r=>r.payload||{
      id:r.id,debtAccountId:r.debt_account_id,month:r.month,dueDate:r.due_date,createdAt:r.created_at
    }),
    paymentClaims:claimRows.map(r=>r.payload||{
      id:r.id,planId:r.plan_id,debtAccountId:r.debt_account_id,user:r.user_name,month:r.month,
      amount:Number(r.amount||0),paymentDate:r.payment_date,status:r.status,approvedBy:r.approved_by,
      approvedAt:r.approved_at,rejectedAt:r.rejected_at,createdAt:r.created_at
    }),
    notifications:notificationRows.map(r=>r.payload||{
      id:r.id,targetUser:r.target_user,title:r.title,message:r.message,read:!!r.is_read,createdAt:r.created_at
    }),
    prices,
    priceNames,
    settings:{debtDueDay:Number(settingsRes?.data?.debt_due_day||5)}
  };
}

async function deleteAll(table,column='id'){
  const result=await supabaseAdmin.from(table).delete().neq(column,'__never__');
  if(result.error) throw new Error(`${table} delete: ${result.error.message||'Supabase error'}`);
}

async function insertRows(table,rows){
  if(!rows.length)return;
  const result=await supabaseAdmin.from(table).insert(rows);
  if(result.error) throw new Error(`${table} insert: ${result.error.message||'Supabase error'}`);
}

export async function writeState(state){
  const clean={
    ...defaultState(),
    ...state,
    version:7,
    updatedAt:new Date().toISOString()
  };

  // Passkeys are intentionally not touched here.
  await deleteAll('kck_transactions');
  await deleteAll('kck_payment_claims');
  await deleteAll('kck_debt_plans');
  await deleteAll('kck_notifications');
  await deleteAll('kck_accounts');
  await deleteAll('kck_prices','key');

  await insertRows('kck_accounts',(clean.accounts||[]).map(accountRow));
  await insertRows('kck_transactions',(clean.transactions||[]).map(transactionRow));
  await insertRows('kck_debt_plans',(clean.debtPlans||[]).map(planRow));
  await insertRows('kck_payment_claims',(clean.paymentClaims||[]).map(claimRow));
  await insertRows('kck_notifications',(clean.notifications||[]).map(notificationRow));

  const priceRows=Object.entries(clean.prices||{}).map(([k,v])=>({
    key:k,
    name:clean.priceNames?.[k]||k,
    value:Number(v||0),
    updated_at:new Date().toISOString()
  }));
  await insertRows('kck_prices',priceRows);

  const settingsResult=await supabaseAdmin.from('kck_settings').upsert({
    id:'main',
    debt_due_day:Number(clean.settings?.debtDueDay||5),
    updated_at:new Date().toISOString()
  },{onConflict:'id'});
  if(settingsResult.error) throw new Error(`kck_settings upsert: ${settingsResult.error.message||'Supabase error'}`);

  return readState();
}

export async function credentialsForUser(user){
  const {data,error}=await supabaseAdmin
    .from('kck_passkeys')
    .select('*')
    .eq('user_name',user)
    .order('created_at',{ascending:true});
  if(error) throw error;
  return (data||[]).map(row=>({
    id:row.credential_id,
    publicKey:row.public_key,
    counter:Number(row.counter||0),
    transports:Array.isArray(row.transports)?row.transports:[],
    deviceType:row.device_type||null,
    backedUp:!!row.backed_up,
    createdAt:row.created_at,
    ...(row.payload||{})
  }));
}

export async function upsertCredential(user,cred){
  const row={
    credential_id:cred.id,
    user_name:user,
    public_key:cred.publicKey,
    counter:Number(cred.counter||0),
    transports:cred.transports||[],
    device_type:cred.deviceType||null,
    backed_up:!!cred.backedUp,
    created_at:cred.createdAt||new Date().toISOString(),
    payload:cred
  };
  const {error}=await supabaseAdmin
    .from('kck_passkeys')
    .upsert(row,{onConflict:'credential_id'});
  if(error) throw error;
}

export async function markNotificationsRead(user){
  const {data,error}=await supabaseAdmin
    .from('kck_notifications')
    .select('id,payload')
    .eq('target_user',user)
    .eq('is_read',false);
  if(error) throw error;
  if(!data?.length)return;
  for(const row of data){
    const payload={...(row.payload||{}),read:true};
    const {error:updateError}=await supabaseAdmin
      .from('kck_notifications')
      .update({is_read:true,payload})
      .eq('id',row.id);
    if(updateError) throw updateError;
  }
}
