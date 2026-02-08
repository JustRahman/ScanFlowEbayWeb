import { NextResponse } from 'next/server';
import { markBookAction } from '@/services/supabase';

export async function POST(request: Request) {
  try {
    const { id, action } = await request.json();

    if (!id || typeof id !== 'number') {
      return NextResponse.json({ error: 'Missing or invalid book id' }, { status: 400 });
    }

    if (action !== 'BOUGHT' && action !== 'REJECT') {
      return NextResponse.json({ error: 'Action must be BOUGHT or REJECT' }, { status: 400 });
    }

    const success = await markBookAction(id, action);

    if (!success) {
      return NextResponse.json({ error: 'Failed to update book' }, { status: 500 });
    }

    return NextResponse.json({ success: true, id, action });
  } catch (error) {
    console.error('Book action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
