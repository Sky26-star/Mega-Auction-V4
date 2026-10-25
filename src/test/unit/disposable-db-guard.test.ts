import { describe, expect, it } from 'vitest';
import { resolveDisposableDatabaseTarget } from '../database/disposable-db-guard';

describe('resolveDisposableDatabaseTarget', () => {
  it('skips explicitly when the disposable URL is unset and ignores DATABASE_URL', () => {
    const result = resolveDisposableDatabaseTarget({
      DATABASE_URL: 'postgresql://private-user:private-password@127.0.0.1:54325/postgres',
    });

    expect(result).toEqual({
      configured: false,
      reason: expect.stringContaining('DISPOSABLE_TEST_DATABASE_URL is unset'),
    });
    expect(JSON.stringify(result)).not.toContain('private-password');
  });

  it('rejects an empty disposable URL', () => {
    expect(() =>
      resolveDisposableDatabaseTarget({ DISPOSABLE_TEST_DATABASE_URL: '' })
    ).toThrow('DISPOSABLE_TEST_DATABASE_URL is empty');
  });

  it('rejects malformed URLs without echoing the input', () => {
    const malformed = 'postgresql://secret-password-is-private';
    let message = '';

    try {
      resolveDisposableDatabaseTarget({ DISPOSABLE_TEST_DATABASE_URL: malformed });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('is malformed');
    expect(message).not.toContain(malformed);
    expect(message).not.toContain('secret-password-is-private');
  });

  it('rejects remote hosts and never includes credentials in the error', () => {
    const secret = 'do-not-leak-this-password';
    let message = '';

    try {
      resolveDisposableDatabaseTarget({
        DISPOSABLE_TEST_DATABASE_URL: `postgresql://user:${secret}@db.example.com:55325/postgres`,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('exactly 127.0.0.1:55325');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('db.example.com');
  });

  it.each([54321, 54322, 54323, 54324, 54325, 54326, 54327])(
    'rejects original-stack port %i',
    (port) => {
      expect(() =>
        resolveDisposableDatabaseTarget({
          DISPOSABLE_TEST_DATABASE_URL: `postgresql://user:password@127.0.0.1:${port}/postgres`,
        })
      ).toThrow('exactly 127.0.0.1:55325');
    }
  );

  it('rejects port 55326', () => {
    expect(() =>
      resolveDisposableDatabaseTarget({
        DISPOSABLE_TEST_DATABASE_URL: 'postgresql://user:password@127.0.0.1:55326/postgres',
      })
    ).toThrow('exactly 127.0.0.1:55325');
  });

  it('rejects localhost and IPv6 loopback hostnames', () => {
    for (const host of ['localhost', '[::1]']) {
      expect(() =>
        resolveDisposableDatabaseTarget({
          DISPOSABLE_TEST_DATABASE_URL: `postgresql://user:password@${host}:55325/postgres`,
        })
      ).toThrow('exactly 127.0.0.1:55325');
    }
  });

  it('rejects URL query parameters that could override host or port routing', () => {
    expect(() =>
      resolveDisposableDatabaseTarget({
        DISPOSABLE_TEST_DATABASE_URL:
          'postgresql://user:password@127.0.0.1:55325/postgres?host=db.example.com',
      })
    ).toThrow('exactly 127.0.0.1:55325');
  });

  it('accepts PostgreSQL on exactly 127.0.0.1:55325 without exposing the URL in errors', () => {
    const connectionString =
      'postgresql://test-user:private-password@127.0.0.1:55325/postgres';

    expect(
      resolveDisposableDatabaseTarget({ DISPOSABLE_TEST_DATABASE_URL: connectionString })
    ).toEqual({ configured: true, connectionString });
  });
});
