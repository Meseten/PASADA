// Component tests for CHANGE 2: the restore affordance on the Activity Logs
// DELETE_RECORD rows. Network mocked at fetchWithAuth; confirmDialog mocked.
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

import LogsPage from "./page"

type FetchInit = { method?: string; body?: string }
type Handler = (url: string, init: FetchInit) => any
type LogRow = Record<string, unknown>

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const baseLog: LogRow = {
  id: "L1",
  timestamp: "2026-10-20T08:00:00",
  user: "CLERK WORKER",
  target_record: "SBN-9 (JUAN)",
  details: "deleted the record",
}

const deleteLog = (recordId: string): LogRow => ({
  ...baseLog,
  id: `L-${recordId}`,
  action: "DELETE_RECORD",
  raw_record_id: recordId,
})

function routeFetch(routes: Record<string, Handler>) {
  fetchWithAuthMock.mockImplementation(async (url: string, init: FetchInit = {}) => {
    for (const [match, handler] of Object.entries(routes)) {
      if (url.includes(match)) return handler(url, init)
    }
    console.warn(`[test] unmocked ${init.method || "GET"} ${url}`)
    return ok({})
  })
}

const POSTS = () =>
  fetchWithAuthMock.mock.calls.filter(([, i]: any) => i?.method === "POST")

beforeEach(() => {
  fetchWithAuthMock.mockReset()
  confirmDialogMock.mockReset()
  localStorage.clear()
  localStorage.setItem("pasada_token", "test-token")
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("Activity Logs — RESTORE VIA DELETE ROWS (CHANGE 2)", () => {
  it("files a restore ticket with the row's raw record id, then shows 'Restore pending approval'", async () => {
    routeFetch({
      "/logs/actions": () => ok({ routes: [], actions: [] }),
      "/admin/tickets": (u) =>
        u.includes("status_filter=pending")
          ? ok([]) // nothing already pending when the page opens
          : ok({}),
      "/logs?page=": () => ok({ items: [deleteLog("RID-1")], total: 1 }),
      "/api/restore-records/ticket": () =>
        ok({ status: "ticket_filed", message: "Restore request sent for approval." }),
    })

    render(<LogsPage />)

    // The row loads with its affordance…
    const btn = await screen.findByRole("button", { name: "Request restore" }, { timeout: 3000 })
    confirmDialogMock.mockResolvedValueOnce("please re-add")
    await userEvent.click(btn)

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "prompt", title: "Request restore — SBN-9 (JUAN)" }),
    )
    await waitFor(() => {
      const post = POSTS().find(([u]: any) => String(u).includes("/api/restore-records/ticket"))
      expect(post).toBeTruthy()
      const [, init] = post as [string, FetchInit]
      expect(JSON.parse(init.body!)).toEqual({
        record_ids: ["RID-1"],
        override_reason: "please re-add",
        reason: "please re-add",
      })
    })
    // After filing, the row switches to the pending marker (no more button).
    await screen.findByText("Restore pending approval")
    expect(screen.queryByRole("button", { name: "Request restore" })).not.toBeInTheDocument()
  })

  it("shows 'Restore pending approval' with no button for record ids already covered by an open ticket", async () => {
    routeFetch({
      "/logs/actions": () => ok({ routes: [], actions: [] }),
      "/admin/tickets": (u) =>
        u.includes("status_filter=pending")
          ? ok([
              {
                id: "T-1",
                ticket_type: "record_restore",
                status: "pending",
                payload: { record_ids: ["RID-1"] },
              },
            ])
          : ok({}),
      "/logs?page=": () => ok({ items: [deleteLog("RID-1")], total: 1 }),
    })

    render(<LogsPage />)

    await screen.findByText("Restore pending approval", {}, { timeout: 3000 })
    expect(screen.queryByRole("button", { name: "Request restore" })).not.toBeInTheDocument()
    // Nothing filed by us — the pending ticket came from the queue.
    expect(
      POSTS().filter(([u]: any) => String(u).includes("/api/restore-records/ticket")),
    ).toHaveLength(0)
  })

  it("only flips the clicked row: a sibling delete row keeps its Request restore button after one file", async () => {
    // Both rows file tickets here (ticket_filed). Only the clicked row must
    // flip to the pending marker; RID-2 keeps its button.
    routeFetch({
      "/logs/actions": () => ok({ routes: [], actions: [] }),
      "/admin/tickets": (u) => (u.includes("status_filter=pending") ? ok([]) : ok({})),
      "/logs?page=": () => ok({ items: [deleteLog("RID-1"), deleteLog("RID-2")], total: 2 }),
      "/api/restore-records/ticket": () =>
        ok({ status: "ticket_filed", message: "Restore request sent for approval." }),
    })

    render(<LogsPage />)

    const buttons = await screen.findAllByRole("button", { name: "Request restore" }, { timeout: 3000 })
    expect(buttons).toHaveLength(2)
    confirmDialogMock.mockResolvedValueOnce("fix it")
    await userEvent.click(buttons[0])

    // Only ONE restore POST left the page.
    await waitFor(() => expect(POSTS()).toHaveLength(1))
    // The clicked row now shows the pending marker; the other keeps its button.
    await screen.findByText("Restore pending approval")
    expect(screen.getAllByRole("button", { name: "Request restore" })).toHaveLength(1)
  })
})
