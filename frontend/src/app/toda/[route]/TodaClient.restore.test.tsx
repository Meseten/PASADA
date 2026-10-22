// Component tests for CHANGE 1 + CHANGE 3 (TodaClient): the restore
// affordance inside the per-record History dialog and the post-delete
// "Undo Delete" banner. The network is mocked at fetchWithAuth, so these
// assert what the frontend ACTUALLY SENDS and how it reacts to the answers —
// the backend behavior itself is covered by backend/tests/test_restore_flow_live.py.
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
  resolveAutoChangeMotorDate: (v: string | null) => v === "true",
}))

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirmDialog: confirmDialogMock,
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ route: "NCTODA" }),
  usePathname: () => "/toda/NCTODA",
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

import TodaClient from "./TodaClient"

type FetchInit = { method?: string; body?: string }
type Handler = (url: string, init: FetchInit) => any

const MEMBER = {
  id: "REC-1",
  sbn_no: "SBN-1",
  operator_name: "JUAN DELA CRUZ",
  address: "NAIC, CAVITE",
  plate_no: "PLT-1",
  motor_no: "MC-1",
  chassis_no: "CH-1",
  make: "HONDA",
  route: "NCTODA",
  driving_route: "NCTODA",
  issue_date: "2026-01-01T00:00:00",
  valid_until: "2027-01-01T00:00:00",
  is_active: true,
}

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

// Dispatch the fetch mock by URL substring; unmocked URLs answer with an
// empty object so a stray mount-effect fetch never kills a test silently
// (it warns on the console instead).
function routeFetch(routes: Record<string, Handler>) {
  fetchWithAuthMock.mockImplementation(async (url: string, init: FetchInit = {}) => {
    for (const [match, handler] of Object.entries(routes)) {
      if (url.includes(match)) return handler(url, init)
    }
    console.warn(`[test] unmocked ${init.method || "GET"} ${url}`)
    return ok({})
  })
}

function mountToda(role: string) {
  localStorage.clear()
  localStorage.setItem("pasada_role", role)
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

describe("TodaClient — RESTORE VIA HISTORY (CHANGE 1)", () => {
  it("offers a Clerk 'Request Restore' for a deleted record, and files the ticket with the clerk's reason", async () => {
    mountToda("Clerk")
    let restoreState = { is_deleted: true, restore_requested: false, current_role: "Clerk" }
    routeFetch({
      "/franchise/route/NCTODA": () => ok([MEMBER]),
      "/api/route-info/NCTODA": () => ok({ route: "NCTODA", display_name: "P", dominant_route: "NCTODA" }),
      "/logs/record/REC-1": () => ok([]),
      "/tickets/for-record/REC-1": () => ok(restoreState),
      "/api/restore-records/ticket": () => {
        // The dialog re-asks the backend right after filing, so the answer to
        // THAT check flips here, with the POST response.
        restoreState = { is_deleted: true, restore_requested: true, current_role: "Clerk" }
        return ok({ status: "ticket_filed", message: "Restore request sent for approval." })
      },
    })

    render(<TodaClient />)
    await screen.findByText("JUAN DELA CRUZ", {}, { timeout: 3000 })
    await userEvent.click(screen.getByLabelText("Record History"))
    expect(
      fetchWithAuthMock.mock.calls.some(([u]: any) => String(u).includes("/tickets/for-record/REC-1")),
    ).toBe(true)

    const btn = await screen.findByRole("button", { name: "Request Restore" })
    expect(btn).toBeEnabled()

    confirmDialogMock.mockResolvedValueOnce("wrong entry")
    await userEvent.click(btn)

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "prompt", title: "Request restore — SBN-1" }),
    )
    await waitFor(() => {
      const post = POSTS().find(([u]: any) => String(u).includes("/api/restore-records/ticket"))
      expect(post).toBeTruthy()
      const [, init] = post as [string, FetchInit]
      expect(JSON.parse(init.body!)).toEqual({
        record_ids: ["REC-1"],
        override_reason: "wrong entry",
        reason: "wrong entry",
      })
    })
    // After filing, the dialog re-checked the state and shows "pending".
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore pending approval" })).toBeDisabled())
  })

  it("tells a Clerk there is already a pending request and disables the button", async () => {
    mountToda("Clerk")
    routeFetch({
      "/franchise/route/NCTODA": () => ok([MEMBER]),
      "/api/route-info/NCTODA": () => ok({ route: "NCTODA", display_name: "P", dominant_route: "NCTODA" }),
      "/logs/record/REC-1": () => ok([]),
      "/tickets/for-record/REC-1": () => ok({ is_deleted: true, restore_requested: true, current_role: "Clerk" }),
    })

    render(<TodaClient />)
    await screen.findByText("JUAN DELA CRUZ", {}, { timeout: 3000 })
    await userEvent.click(screen.getByLabelText("Record History"))

    const btn = await screen.findByRole("button", { name: "Restore pending approval" })
    expect(btn).toBeDisabled()
    expect(screen.getByText("A restore request is already waiting for approval."))
    // Nothing was filed.
    expect(POSTS()).toHaveLength(0)
  })

  it("gives the Admin a 'Restore now' path that executes directly with the typed reason", async () => {
    mountToda("Admin")
    routeFetch({
      "/franchise/route/NCTODA": () => ok([MEMBER]),
      "/api/route-info/NCTODA": () => ok({ route: "NCTODA", display_name: "P", dominant_route: "NCTODA" }),
      "/logs/record/REC-1": () => ok([]),
      "/tickets/for-record/REC-1": () => ok({ is_deleted: true, restore_requested: false, current_role: "Admin" }),
      "/api/restore-records/ticket": (_u, i) => {
        expect(JSON.parse(i.body!)).toEqual({
          record_ids: ["REC-1"],
          override_reason: "entered in error",
          reason: "entered in error",
        })
        return ok({ status: "success", message: "Record restored." })
      },
    })

    render(<TodaClient />)
    await screen.findByText("JUAN DELA CRUZ", {}, { timeout: 3000 })
    await userEvent.click(screen.getByLabelText("Record History"))

    const btn = await screen.findByRole("button", { name: "Restore now" })
    confirmDialogMock.mockResolvedValueOnce("entered in error")
    await userEvent.click(btn)

    await waitFor(() =>
      expect(fetchWithAuthMock.mock.calls.some(([u, i]: any) => i?.method === "POST" && String(u).includes("/api/restore-records/ticket"))).toBe(true),
    )
    // Success closes the History dialog.
    await waitFor(() => expect(screen.queryByText("This record is deleted.")).not.toBeInTheDocument())
  })

  it("cancels without filing anything when the reason prompt is dismissed", async () => {
    mountToda("Clerk")
    routeFetch({
      "/franchise/route/NCTODA": () => ok([MEMBER]),
      "/api/route-info/NCTODA": () => ok({ route: "NCTODA", display_name: "P", dominant_route: "NCTODA" }),
      "/logs/record/REC-1": () => ok([]),
      "/tickets/for-record/REC-1": () => ok({ is_deleted: true, restore_requested: false, current_role: "Clerk" }),
    })

    render(<TodaClient />)
    await screen.findByText("JUAN DELA CRUZ", {}, { timeout: 3000 })
    await userEvent.click(screen.getByLabelText("Record History"))

    const btn = await screen.findByRole("button", { name: "Request Restore" })
    confirmDialogMock.mockResolvedValueOnce(null)
    await userEvent.click(btn)

    await waitFor(() => expect(confirmDialogMock).toHaveBeenCalled())
    // Cancellation issues no POST at all.
    await waitFor(() => expect(POSTS()).toHaveLength(0))
  })
})

describe("TodaClient — UNDO TOAST after delete (CHANGE 3)", () => {
  it("posts the undo restore for the deleted record when 'Undo Delete' is clicked", async () => {
    mountToda("Clerk")
    routeFetch({
      "/franchise/route/NCTODA": () => ok([MEMBER]),
      "/api/route-info/NCTODA": () => ok({ route: "NCTODA", display_name: "P", dominant_route: "NCTODA" }),
      "/api/operators/REC-1": (_u, i) =>
        i.method === "DELETE" ? ok({}) : ok({}), // POST …/restore
    })

    render(<TodaClient />)
    await screen.findByText("JUAN DELA CRUZ", {}, { timeout: 3000 })

    // Delete the record: the delete prompt resolves "true" (confirmed).
    confirmDialogMock.mockResolvedValueOnce(true)
    await userEvent.click(screen.getByLabelText("Delete Operator"))

    // The undo banner appears; "Undo Delete" restores via POST …/restore.
    const undoBtn = await screen.findByRole("button", { name: "Undo Delete" })
    await userEvent.click(undoBtn)

    await waitFor(() =>
      expect(fetchWithAuthMock.mock.calls.some(([u, i]: any) => i?.method === "POST" && String(u).includes("/api/operators/REC-1/restore"))).toBe(true),
    )
    // After the undo, the banner is gone.
    await waitFor(() => expect(screen.queryByText(/Deleted 1 record\(s\)\./)).not.toBeInTheDocument())
  })
})
