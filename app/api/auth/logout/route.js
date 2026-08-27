import { NextResponse } from 'next/server';import { clearSession } from '../../../../lib/auth.js';
export async function POST(){await clearSession();return NextResponse.json({ok:true})}
