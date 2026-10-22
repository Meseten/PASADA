// Component tests for CHANGE 4: the "Restore now" entry on the Admin
// console's Approvals tab. Network mocked at fetchWithAuth; confirmDialog
// mocked. Recharts and the OfficeAccounts tab are stubbed — they render
// outside the Approvals tab and only add render-time noise.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const { fetchWithAuthMock, confirmDialogMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  confirmDialogMock: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  API_URL: "http://test.local",
  fetchWithAuth: fetchWithAuthMock,
}))

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirmDialog: confirmDialogMock,
}))

vi.mock("@/components/office-accounts", () => ({ default: () => null }))

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    BarChart: Stub,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    Tooltip: Stub,
    ResponsiveContainer: Stub,
  }
})

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

import AdminConsole from "./page"

type FetchInit = { method?: string; body?: string }
type Handler = (url: string, init: FetchInit) => any

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const RESTORE_TICKET = {
  id: "T-1",
  ticket_type: "record_restore",
  status: "pending",
  created_by: "CLERK WORKER",
  created_at: "2026-10-20T08:00:00",
  reason: "wrong delete",
  payload: { record_ids: ["REC-9"] },
}

function routeFetch(routes: Record<string, Handler>) {
  fetchWithAuthMock.mockImplementation(async (url: string, init: FetchInit = {}) => {
    for (const [match, handler] of Object.entries(routes)) {
      if (url.includes(match)) return handler(url, init)
    }
    console.warn(`[test] unmocked ${init.method || "GET"} ${url}`)
    return ok({})
  })
}

function mountAdminAdmin() {
  localStorage.clear()
  localStorage.setItem("pasada_role", "Admin")
  localStorage.setItem("pasada_token", "test-token")
}

const POSTS = () =>
  fetchWithAuthMock.mock.calls.filter(([, i]: any) => i?.method === "POST")

beforeEach(() => {
  fetchWithAuthMock.mockReset()
  confirmDialogMock.mockReset()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("Admin console — RESTORE NOW on the Approvals tab (CHANGE 4)", () => {
  it("restores the ticket's records directly with a mandatory reason, then closes the ticket", async () => {
    mountAdminAdmin()
    let queue: object[] = [RESTORE_TICKET]
    routeFetch({
      "/admin/tickets/T-1/approve": (_u, i) => {
        expect(i.method).toBe("POST")
        expect(JSON.parse(i.body!)).toEqual({ note: "Restored directly by the Admin." })
        queue = []
        return ok({ result_note: "Restored 1 record(s)." })
      },
      "/admin/diagnostics": () => ok({}),
      "/admin/audit-overview": () => ok({ total_logs: 0, logs_last_7_days: 0, last_activity: null, actions_last_7_days: [], users_last_7_days: [], daily_last_7_days: [] }),
      "/admin/templates": () => ok([]),
      "/admin/tickets": (u) =>
        u.includes("status_filter=pending")
          ? ok(queue)
          : u.includes("status_filter=approved")
            ? ok([])
            : ok({}),
    })

    render(<AdminConsole />)

    // Switch to the Approvals tab and find the pending restore ticket.
    await userEvent.click(await screen.findByRole("tab", { name: /Approvals/i }, { timeout: 3000 }))
    await screen.findByText(/asked by/i)
    const restoreBtn = await screen.findByRole("button", { name: /Restore now/i })
    screen.getByRole("button", { name: /Approve/i })

    confirmDialogMock.mockResolvedValueOnce("confirmed with the office")
    await userEvent.click(restoreBtn)

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "prompt", title: "Restore now" }),
    )
    // The restore POST and the ticket-closing approve POST both went out.
    await waitFor(() => {
      expect(POSTS().filter(([u]: any) => String(u).includes("/api/restore-records/ticket"))).toHaveLength(1)
      expect(POSTS().filter(([u]: any) => String(u).includes("/admin/tickets/T-1/approve"))).toHaveLength(1)
    })
    // refreshTickets reloaded the (now empty) queue.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Approve/i })).not.toBeInTheDocument())
  })

  it("refuses to send anything when the reason is empty, as the single-key rule requires", async () => {
    mountAdminAdmin()
    routeFetch({
      "/admin/diagnostics": () => ok({}),
      "/admin/audit-overview": () => ok({ total_logs: 0, logs_last_7_days: 0, last_activity: null, actions_last_7_days: [], users_last_7_days: [], daily_last_7_days: [] }),
      "/admin/templates": () => ok([]),
      "/admin/tickets": (u) => (u.includes("status_filter=pending") ? ok([RESTORE_TICKET]) : ok({})),
    })

    render(<AdminConsole />)
    await userEvent.click(await screen.findByRole("tab", { name: /Approvals/i }, { timeout: 3000 }))
    const restoreBtn = await screen.findByRole("button", { name: /Restore now/i })

    confirmDialogMock.mockResolvedValueOnce("   ") // whitespace-only reason
    await userEvent.click(restoreBtn)

    await waitFor(() => expect(confirmDialogMock).toHaveBeenCalled())
    // No POST of any kind — a reason is mandatory.
    await waitFor(() => expect(POSTS()).toHaveLength(0))
  })

  it("does nothing but complain when the ticket carries no record ids", async () => {
    mountAdminAdmin()
    routeFetch({
      "/admin/diagnostics": () => ok({}),
      "/admin/audit-overview": () => ok({ total_logs: 0, logs_last_7_days: 0, last_activity: null, actions_last_7_days: [], users_last_7_days: [], daily_last_7_days: [] }),
      "/admin/templates": () => ok([]),
      "/admin/tickets": (u) =>
        u.includes("status_filter=pending")
          ? ok([{ ...RESTORE_TICKET, id: "T-2", payload: {} }])
          : ok({}),
    })

    render(<AdminConsole />)
    await userEvent.click(await screen.findByRole("tab", { name: /Approvals/i }, { timeout: 3000 }))

    // The empty ticket still renders its Restore now button; clicking it
    // must not fire any network call.
    const restoreBtn = await screen.findByRole("button", { name: /Restore now/i })
    await userEvent.click(restoreBtn)
    await waitFor(() => expect(POSTS()).toHaveLength(0))
    // The confirmDialog was never needed — the guard trips before it.
    expect(confirmDialogMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Restore now" }))
  })
})
