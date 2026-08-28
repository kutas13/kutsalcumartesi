import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth.js';
import { markNotificationsRead } from '../../../../lib/supabase-admin.js';

export async function POST(){
  const s=await getSession();
  if(!s)return NextResponse.json({error:'Oturum gerekli.'},{status:401});
  try{
    await markNotificationsRead(s.user);
    return NextResponse.json({ok:true});
  }catch(e){
    return NextResponse.json({error:'Bildirimler güncellenemedi.',detail:String(e?.message||e)},{status:500});
  }
}
