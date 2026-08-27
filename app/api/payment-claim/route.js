import { NextResponse } from 'next/server';import { getSession } from '../../../lib/auth.js';import { readState,writeState } from '../../../lib/supabase-admin.js';
export async function POST(req){
  const s=await getSession();if(!s)return NextResponse.json({error:'Oturum gerekli.'},{status:401});
  try{
    const {planId,paymentDate,note}=await req.json();const state=await readState();const p=state.debtPlans.find(x=>x.id===planId);if(!p)return NextResponse.json({error:'Ödeme planı bulunamadı.'},{status:404});
    const amount=Number(p.amounts?.[s.user]||0);if(amount<=0)return NextResponse.json({error:'Bu ay size tanımlı ödeme yok.'},{status:400});
    if(state.paymentClaims.some(c=>c.planId===planId&&c.user===s.user&&c.status==='pending'))return NextResponse.json({error:'Zaten onay bekleyen bildiriminiz var.'},{status:409});
    const id=`claim_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;state.paymentClaims.push({id,planId,debtAccountId:p.debtAccountId,user:s.user,month:p.month,amount,paymentDate,note:String(note||''),status:'pending',createdAt:new Date().toISOString()});
    await writeState(state);return NextResponse.json({ok:true,state});
  }catch(e){return NextResponse.json({error:'Ödeme bildirimi gönderilemedi.',detail:String(e?.message||e)},{status:500})}
}
