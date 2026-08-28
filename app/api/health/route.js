import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth.js';
import { readState } from '../../../lib/supabase-admin.js';

export const dynamic='force-dynamic';

export async function GET(){
  const s=await getSession();
  if(!s)return NextResponse.json({ok:false,error:'Oturum gerekli.'},{status:401});
  try{
    const state=await readState();
    const required=['acc_main','acc_yusuf','acc_taha','acc_omer'];
    const ids=new Set((state.accounts||[]).map(a=>a.id));
    const missing=required.filter(id=>!ids.has(id));
    return NextResponse.json({
      ok:missing.length===0,
      sql:true,
      user:s.user,
      accounts:(state.accounts||[]).length,
      transactions:(state.transactions||[]).length,
      debtPlans:(state.debtPlans||[]).length,
      paymentClaims:(state.paymentClaims||[]).length,
      notifications:(state.notifications||[]).length,
      missingCoreAccounts:missing
    },{status:missing.length?500:200});
  }catch(e){
    return NextResponse.json({ok:false,sql:false,error:String(e?.message||e)},{status:500});
  }
}
