// Component tests for the PIN-pairing panel (Connections card).
// Network is mocked at fetchWithAuth, exactly like the restore tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const { fetchWithAuthMock } = vi.hoisted(() => ({ fetchWithAuthMock: vi.fn() }))

vi.mock("@/lib/api", () => ({
  API_URL: "http://test.local",
  fetchWithAuth: (url: string, init?: RequestInit) => fetchWithAuthMock(url, init),
}))

import PairingPanel from "./PairingPanel"

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => { fetchWithAuthMock.mockReset() })
afterEach(cleanup)

describe("PairingPanel", () => {
  it("renders nothing for a clerk", () => {
    fetchWithAuthMock.mockResolvedValue(ok({ armed: false, expires_in_seconds: 0, fingerprint: "F1" }))
    const { container } = render(<PairingPanel isAdmin={false} onAfterChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchWithAuthMock).not.toHaveBeenCalled()
  })

  it("arms a generated PIN and shows the digits exactly once", async () => {
    fetchWithAuthMock.mockImplementation((url: string) => {
      if (url.endsWith("/system/pairing-pin/status")) return Promise.resolve(ok({ armed: false, expires_in_seconds: 0, fingerprint: "F1", computer_name: "PC-1" }))
      if (url.endsWith("/system/pairing-pin/arm")) return Promise.resolve(ok({ status: "success", pin: "482613", expires_in_seconds: 600 }))
      return Promise.resolve(ok({}, 404))
    })
    const user = userEvent.setup()
    render(<PairingPanel isAdmin={true} onAfterChange={vi.fn()} />)

    await screen.findByText("Pair a computer with a PIN")
    await user.click(screen.getByRole("button", { name: /generate a pin/i }))

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      "http://test.local/system/pairing-pin/arm",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    )
    const shown = await screen.findByText("482613")
    expect(shown).toBeTruthy()
    // Status polling must not leak: after arming the digits stay visible.
    await waitFor(() => expect(screen.getByText(/Clear the PIN/i)).toBeTruthy())
  })

  it("arms the admin's own six digits and clears it", async () => {
    fetchWithAuthMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/system/pairing-pin/status")) return Promise.resolve(ok({ armed: false, expires_in_seconds: 0, fingerprint: "F1", computer_name: "PC-1" }))
      if (url.endsWith("/system/pairing-pin/arm")) return Promise.resolve(ok({ status: "success", pin: "718253", expires_in_seconds: 600 }))
      if (url.endsWith("/system/pairing-pin/clear")) return Promise.resolve(ok({ status: "success", armed: false }))
      return Promise.resolve(ok({}, 404))
    })
    const user = userEvent.setup()
    render(<PairingPanel isAdmin={true} onAfterChange={vi.fn()} />)

    const field = await screen.findByLabelText("Type your own PIN six digits")
    await user.type(field, "718253")
    await user.click(screen.getByRole("button", { name: "Arm" }))

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      "http://test.local/system/pairing-pin/arm",
      expect.objectContaining({ body: JSON.stringify({ pin: "718253" }) }),
    )
    await screen.findByText("718253")
    await user.click(screen.getByRole("button", { name: /clear the pin/i }))
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      "http://test.local/system/pairing-pin/clear",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("joins another computer with a typed PIN and shows the fingerprint", async () => {
    fetchWithAuthMock.mockImplementation((url: string) => {
      if (url.endsWith("/system/pairing-pin/status")) return Promise.resolve(ok({ armed: false, expires_in_seconds: 0, fingerprint: "F1", computer_name: "PC-2" }))
      if (url.endsWith("/system/pairing-pin/join")) return Promise.resolve(ok({ status: "success", joined: true, fingerprint: "ABCD1234EFGH5678", message: "Joined the cluster." }))
      return Promise.resolve(ok({}, 404))
    })
    const onAfterChange = vi.fn()
    const user = userEvent.setup()
    await render(<PairingPanel isAdmin={true} onAfterChange={onAfterChange} />)

    const field = await screen.findByLabelText("The shared PIN six digits")
    await user.type(field, "482613")
    await user.click(screen.getByRole("button", { name: "Join" }))
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      "http://test.local/system/pairing-pin/join",
      expect.objectContaining({ body: JSON.stringify({ pin: "482613", host_ip: "" }) }),
    )
    await screen.findByText(/ABCD1234EFGH5678/)
    expect(onAfterChange).toHaveBeenCalled()
  })

  it("surfaces the no-reply hint when the join finds nothing", async () => {
    fetchWithAuthMock.mockImplementation((url: string) => {
      if (url.endsWith("/system/pairing-pin/status")) return Promise.resolve(ok({ armed: false, expires_in_seconds: 0, fingerprint: "F1", computer_name: "PC-2" }))
      if (url.endsWith("/system/pairing-pin/join")) return Promise.resolve(ok({ status: "success", joined: false, fingerprint: "", message: "No reply yet. Make sure the other computer has ARMED a PIN." }))
      return Promise.resolve(ok({}, 404))
    })
    const user = userEvent.setup()
    render(<PairingPanel isAdmin={true} onAfterChange={vi.fn()} />)

    const field = await screen.findByLabelText("The shared PIN six digits")
    await user.type(field, "111111")
    await user.click(screen.getByRole("button", { name: "Join" }))
    await screen.findByText(/Make sure the other computer has ARMED a PIN/i)
  })
})
