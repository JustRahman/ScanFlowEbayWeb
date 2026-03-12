import { NextResponse } from 'next/server';

const BOT_TOKEN = '8688920088:AAGKPQWSgbIE81jwtREZyCbx50SL9KVS6xM';
const CHAT_ID = '939710361';

export async function POST(request: Request) {
  try {
    const { seller } = await request.json();
    const message = `Ready for new books!\n\nSeller: ${seller}\nUser finished reviewing the current 25+25 set.`;

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message }),
    });

    if (!res.ok) throw new Error('Telegram API error');
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
