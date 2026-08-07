// File: frontend/src/lib/api.test.ts
// Change IDs: HIGH
// 25010 Characteristic: Maintainability

import { describe, it, expect, vi } from 'vitest';
import { computeRecordStatus, fetchWithAuth } from './api';

const mockLocation = { href: '' };
Object.defineProperty(window, 'location', {
    value: mockLocation,
    writable: true
});

global.fetch = vi.fn();

describe('API Library', () => {
    describe('computeRecordStatus', () => {
        it('returns backend status if present (Single Source of Truth)', () => {
            expect(computeRecordStatus({ status: 'FLAGGED' }, 2026)).toBe('FLAGGED');
        });

        it('computes correctly if status is missing', () => {
            expect(computeRecordStatus({ operator_name: '' }, 2026)).toBe('VACANT');
        });

        it('returns REVOKED if explicitly inactive', () => {
            expect(computeRecordStatus({ operator_name: 'John', is_active: false }, 2026)).toBe('REVOKED');
        });

        it('returns REVOKED if issue date is >= 2 years old', () => {
            expect(computeRecordStatus({ operator_name: 'John', issue_date: '2024-01-01T00:00:00' }, 2026)).toBe('REVOKED');
        });

        it('returns FLAGGED if issue date is exactly 1 year old', () => {
            expect(computeRecordStatus({ operator_name: 'John', issue_date: '2025-01-01T00:00:00' }, 2026)).toBe('FLAGGED');
        });

        it('returns ACTIVE if issued in the current year', () => {
            expect(computeRecordStatus({ operator_name: 'John', issue_date: '2026-01-01T00:00:00' }, 2026)).toBe('ACTIVE');
        });
    });

    describe('fetchWithAuth', () => {
        it('intercepts 401 and redirects', async () => {
            (global.fetch as any).mockResolvedValueOnce({ status: 401 });
            
            await expect(fetchWithAuth('/test')).rejects.toThrow('Session expired. Please log in again.');
            expect(window.location.href).toBe('/');
        });

        it('returns response successfully on 200', async () => {
            const mockResponse = { status: 200, json: () => Promise.resolve({ data: 'ok' }) };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const res = await fetchWithAuth('/test');
            expect(res.status).toBe(200);
        });
    });
});