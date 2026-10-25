// Component tests for EDIT UNDO (2026-10-25): the "Undo this edit" button
// inside the per-record History dialog, and the "Undo Changes" action that
// the success toast offers right after an edit is saved. The network is
// mocked at fetchWithAuth (same pattern as TodaClient.restore.test.tsx); the
// backend snapshot/revert behavior itself is covered by
// backend/tests/test_edit_undo.py.
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

const PUTS = () =>
  fetchWithAuthMock.mock.calls.filter(([, i]: any) => i?.method === "PUT")

beforeEach(() => {
  fetchWithAuthMock.mockReset()
  confirmDialogMock.mockReset()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("TodaClient — EDIT UNDO", () => {
  it("shows 'Undo this edit' on History entries that saved before-values, and reverts through the endpoint", async () => {
    mountToda("Clerk")
    const HISTORY = [
      {
        id: "LOG-2",
        timestamp: "2026-10-25T10:00:00",
        clerk_name: "CLERK A",
        action: "EDIT_RECORD",
        details: "Updated record for JUAN DELA CRUZ.",
        // No snapshot: plain DELETE-era entry.
        before_values: null,
      },
      {
        id: "LOG-1",
        timestamp: "2026-10-24T09:00:00",
        clerk_name: "CLERK B",
        action: "RENEWAL",
        details: "Renewed SBN to SBN-2.",
        before_values: JSON.stringify({ sbn_no: "SBN-1", operator_name: "JUAN DELA CRUZ" }),
      },
    ]
    routeFetch({
      "/franchise/route/NCTODA": () => ok([MEMBER]),
      "/api/route-info/NCTODA": () => ok({ route: "NCTODA", display_name: "P", dominant_route: "NCTODA" }),
      "/logs/record/REC-1": () => ok(HISTORY),
      "/tickets/for-record/REC-1": () => ok({ is_deleted: false, restore_requested: false, current_role: "Clerk" }),
      "/api/operators/REC-1/revert": () => ok({ message: "Edit undone. UNIVERSAL-SENTINEL TRAVELLED SAFELY." }),
    })

    render(<TodaClient />)
    await screen.findByText("JUAN DELA CRUZ", {}, { timeout: 3000 })
    await userEvent.click(screen.getByLabelText("Record History"))

    // Only the entry WITH a snapshot gets the button.
    const btn = await screen.findByRole("button", { name: /Undo this edit/ })
    expect(btn).toBeEnabled()

    // Undoing sends a PUT to the revert endpoint with the ENTRY's log id.
    await userEvent.click(btn)
    await waitFor(() => {
      const put = PUTS().find(([u]: any) => String(u).includes("/api/operators/REC-1/revert/LOG-1"))
      expect(put).toBeTruthy()
    })
    // A distinct toast appears (not the wrong-record caption).
    await waitFor(() => {
      expect(screen.getByText(/UNIVERSAL-SENTINEL/)).toBeTruthy()
    })
    expect(screen.queryByText(/The record is back to its values before that change/)).toBeNull()
  })

  it("offers 'Undo Changes' on the success toast right after an edit is saved, and undoes through it", async () => {
    mountToda("Admin")
    routeFetch({
      "/franchise/route/NCTODA": () => ok([MEMBER]),
      "/api/route-info/NCTODA": () => ok({ route: "NCTODA", display_name: "P", dominant_route: "NCTODA" }),
    // The save looks up the newest entry carrying before-values...
    "/logs/record/REC-1": () => ok([{
      id: "LOG-SAVE-1",
      timestamp: "2026-10-25T11:00:00",
      clerk_name: "TEST ADMIN",
      action: "EDIT_RECORD",
      details: "Updated record.",
      before_values: JSON.stringify({ sbn_no: "SBN-1", operator_name: "JUAN DELA CRUZ" }),
    }]),
      "/tickets/for-record/REC-1": () => ok({ is_deleted: false, restore_requested: false, current_role: "Admin" }),
      // The save itself: a normal successful PUT of the prefilled form.
      "/franchise/REC-1": () => ok({
        issue_date: "2026-01-01T00:00:00",
        valid_until: "2027-01-01T00:00:00",
        sbn_no: "SBN-1",
        status: "success",
      }),
      // ...and the Undo button targets its saved snapshot.
      "/api/operators/REC-1/revert": (url) => {
        if (String(url).includes("/revert/LOG-SAVE-1")) {
          return ok({ message: "Edit undone. The record is back to its values before that change." })
        }
        return ok({})
      },
    })

    render(<TodaClient />)
    await screen.findByText("JUAN DELA CRUZ", {}, { timeout: 3000 })

    // Open the edit dialog and save as-is (form starts prefilled).
    await userEvent.click(screen.getByLabelText("Edit Operator"))
    await userEvent.click(await screen.findByRole("button", { name: "Save Changes" }))

    // The toast carries a working Undo action. First prove the save itself
    // succeeded — the "Record updated" toast — so the undo assertion can't
    // pass by accident on a silent failure elsewhere in the dialog.
    await screen.findByText(/Record .*updated/i, {}, { timeout: 4000 });
    const toast = await screen.findByText("Undo Changes", {}, { timeout: 4000 });
    // The save also opened the MTOP preview modal; while it is up the toast
    // cannot be clicked (the overlay locks pointer events). Real users close
    // the preview first, so do the same here.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(toast.closest("button")).toBeEnabled()
    })
    const undo = toast.closest("button")!
    await userEvent.click(undo)
    await waitFor(() => {
      expect(PUTS().some(([u]: any) => String(u).includes("/api/operators/REC-1/revert/LOG-SAVE-1"))).toBe(true)
    })
  })

  it("when the server refuses the undo, the plain-words refusal is shown and nothing silently proceeds", async () => {
    mountToda("Clerk")
    routeFetch({
      "/franchise/route/NCTODA": () => ok([MEMBER]),
      "/api/route-info/NCTODA": () => ok({ route: "NCTODA", display_name: "P", dominant_route: "NCTODA" }),
      "/logs/record/REC-1": () => ok([
        {
          id: "LOG-1",
          timestamp: "2026-10-24T09:00:00",
          clerk_name: "CLERK B",
          action: "EDIT_RECORD",
          details: "Updated record.",
          before_values: JSON.stringify({ sbn_no: "SBN-OLD", operator_name: "JUAN DELA CRUZ" }),
        },
      ]),
      "/tickets/for-record/REC-1": () => ok({ is_deleted: false, restore_requested: false, current_role: "Clerk" }),
      "/api/operators/REC-1/revert": (_u) => ok(
        { detail: "Cannot undo: the SBN from that edit is now used by another record on this computer." },
        409,
      ),
    })

    render(<TodaClient />)
    await screen.findByText("JUAN DELA CRUZ", {}, { timeout: 3000 })
    await userEvent.click(screen.getByLabelText("Record History"))
    await userEvent.click(await screen.findByRole("button", { name: /Undo this edit/ }))

    // The refusal is surfaced in plain words — exactly the reason the server
    // sent back — and the request fires once.
    await waitFor(() => {
      expect(screen.getByText(/Cannot undo: the SBN from that edit is now used by another record/)).toBeTruthy()
    })
    expect(PUTS().length).toBe(1)
  })
})
