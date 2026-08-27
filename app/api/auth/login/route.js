import { NextResponse } from 'next/server';
import { verifyPassword,setSession,userConfig } from '../../../../lib/auth.js';
export async function POST(req){
  try{const {user,password}=await req.json();if(!verifyPassword(user,password))return NextResponse.json({error:'Kullanıcı veya şifre hatalı.'},{status:401});await setSession(user);return NextResponse.json({ok:true,user,role:userConfig[user].role})}catch{return NextResponse.json({error:'Giriş başarısız.'},{status:400})}
}
