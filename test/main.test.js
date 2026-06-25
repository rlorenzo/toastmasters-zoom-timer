import { describe, expect, it, vi } from 'vitest';

// main.js is the thin browser entry: it imports init() and calls it. Mock app.js
// so importing main.js exercises the boot call without firing real camera/IO.
vi.mock('../app.js', () => ({ init: vi.fn() }));

describe('main.js entry', () => {
  it('boots the app by calling init() once', async () => {
    const { init } = await import('../app.js');
    await import('../main.js');
    expect(init).toHaveBeenCalledOnce();
  });
});
