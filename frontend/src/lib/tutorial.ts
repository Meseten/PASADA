"use client"

import { driver, type Driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"

// Guided tour for new clerks. Every step id must match a data-tour attribute
// in the app, otherwise the step is skipped (never crash the app over a tour).
// The tour only starts after login and only once per device; Settings > General
// has a "Step by step guide" card that replays it anytime.
//
// Steps come in variants (tour-add / tour-row-actions): at build time the app
// picks the variant that actually exists on the current screen, so no step ever
// points at a missing target.

let driverObj: Driver | null = null

export function startTour(onDone?: () => void) {
  if (typeof window === "undefined") return
  stopTour()

  // Some targets (dashboard cards, the route list) render only after their
  // data fetch resolves. Poll briefly for them so a slow load never shrinks
  // the tour; after the timeout we proceed with whatever exists.
  const deadline = Date.now() + 4000
  const waitForTargets = () => {
    const done =
      document.querySelector("[data-tour='dashboard-stats']") &&
      document.querySelector("[data-tour='route-search']")
    if (done || Date.now() > deadline) {
      beginTour(onDone)
    } else {
      setTimeout(waitForTargets, 150)
    }
  }
  waitForTargets()
}

function beginTour(onDone?: () => void) {
  driverObj = driver({
    showProgress: true,
    allowClose: true,
    smoothScroll: true,
    overlayColor: "rgba(2, 6, 23, 0.65)",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Got it",
    progressText: "{{current}} of {{total}}",
    popoverClass: "pasada-tour-popover",
    steps: buildSteps(),
    onDestroyed: () => {
      driverObj = null
      window.removeEventListener("resize", handleResize)
      onDone?.()
    },
  })
  // Popovers sit beside the highlighted element whenever the window is wide
  // enough (side by side instead of stacked over it). driver.js repositions on
  // scroll, but not on window resize, so refresh keeps the arrow honest when
  // the clerk resizes or snaps the window during the tour.
  driverObj.drive()
  window.addEventListener("resize", handleResize)
}

function handleResize() {
  driverObj?.refresh()
}

export function stopTour() {
  if (driverObj) {
    const obj = driverObj
    driverObj = null
    obj.destroy()
    window.removeEventListener("resize", handleResize)
  }
}

function buildSteps(): DriveStep[] {
  const all: DriveStep[] = [
    {
      element: "[data-tour='dashboard-nav']",
      popover: {
        title: "Where everything lives",
        description:
          "Dashboard shows your summary. Activity History lists every change made and by whom. Import Records loads data from a file. Inactive Operators holds records not renewed for 2 or more years.",
      },
    },
    {
      // Only exists on the Import page.
      element: "[data-tour='tour-import']",
      popover: {
        title: "Importing records",
        description:
          "Drop an Excel masterlist, a Word document, or a backup database here. PASADA checks every row first and tells you what failed before anything is saved.",
      },
    },
    {
      // Only exists on the Inactive page.
      element: "[data-tour='tour-inactive']",
      popover: {
        title: "The inactive archive",
        description:
          "Operators with 2 or more years of non-renewal. Their slots can be reassigned, but the history stays here for records and printing.",
      },
    },
    {
      // Only exists on the Activity History page.
      element: "[data-tour='tour-logs-filters']",
      popover: {
        title: "The audit trail",
        description:
          "Filter by route or action (pick Change Motor to see only motor swaps with their new dates), and export everything to Excel. Every add, edit, delete, login, and print is recorded here automatically.",
      },
    },
    {
      element: "[data-tour='global-search']",
      popover: {
        title: "Search everything",
        description:
          "Type an operator name or an SBN number here to find any record on any route. The filter below only narrows the route list in the sidebar.",
      },
    },
    {
      element: "[data-tour='route-search']",
      popover: {
        title: "Finding a TODA line",
        description:
          "Type part of a route name to narrow the list. Click a route to open its operators. Hover a route to pin it to the top or delete the whole line.",
      },
    },
    {
      element: "[data-tour='dashboard-stats']",
      popover: {
        title: "The four numbers that matter",
        description:
          "Total operators, active renewals for this year, 1-year non-renewals (amber), and 2+ years non-renewal or vacant slots (red). These update by themselves every few seconds.",
      },
    },
    {
      element: "[data-tour='route-chart']",
      popover: {
        title: "Route Distribution",
        description:
          "Each bar is one TODA line: green is active operators, grey is unrenewed or vacant. Hover a bar for exact numbers. The Renewal Summary button beside the title prints or downloads the official document.",
      },
    },
    {
      element: "[data-tour='route-status']",
      popover: {
        title: "How full is each route",
        description:
          "Pick a route to see how close it is to its limit and what affects the estimate. The panel below shows how reliable the grouping is, in plain words.",
      },
    },
    {
      element: "[data-tour='records-tour']",
      popover: {
        title: "The records table",
        description:
          "One row per franchise slot. The row color matches the status badge: green is Active, amber is a 1-year non-renewal, red is revoked or 2+ years, blue means the slot is Vacant.",
      },
    },
    {
      // Present on the records page, not the dashboard.
      element: "[data-tour='tour-add']",
      popover: {
        title: "Add an operator",
        description:
          "Opens the registration form for this route. The keyboard shortcut is Alt + N. The Batch Print button beside it prints selected certificates (Alt + P).",
      },
    },
    {
      // Desktop viewport: the actions sit at the end of each row.
      element: "[data-tour='tour-row-actions']",
      popover: {
        title: "Working a row",
        description:
          "Eye previews the certificate, pencil edits the record, clock shows its full change history, and the trash icon deletes it. Deleting asks for confirmation and is written to Activity History.",
      },
    },
    {
      // Lives in the sidebar footer on every signed-in page.
      element: "[data-tour='footer-status']",
      popover: {
        title: "Connection status",
        description:
          "Green Online means records sync normally between computers on your network. Amber Offline Mode means no network right now: nothing is lost, records stay on this computer and sync when you are back online.",
      },
    },
    {
      element: "[data-tour='theme-toggle']",
      popover: {
        title: "Light or dark",
        description:
          "The sun or moon shows which mode is ON right now. Click to switch. PASADA remembers your choice on this computer.",
      },
    },
    {
      element: "[data-tour='tour-settings']",
      popover: {
        title: "Settings",
        description:
          "Backups, your sign-in details, the Quick PIN lock, and connections between computers all live here.",
      },
    },
    {
      // Only exists inside Settings > General.
      element: "[data-tour='tour-guide-card']",
      popover: {
        title: "Replay this tutorial",
        description:
          "Forgot something? This card replays the walkthrough anytime. The same tab holds the app updater, so staying current is one click.",
      },
    },
  ]

  // Keep only steps whose target actually exists on the current page. For
  // steps with variants, keep the first variant that resolves so the flow
  // never shows two steps for the same thing. Popovers sit BESIDE their
  // target when there is room (side-by-side layout the user asked for):
  // sidebar elements open to the right, full-width sections open below.
  const halfWindow = window.innerWidth * 0.55
  const steps: DriveStep[] = []
  for (const step of all) {
    const el = step.element as string
    let resolved: string | null = null
    if (el.includes("|")) {
      resolved = el.split("|").find((sel) => document.querySelector(sel)) ?? null
      if (!resolved) continue
    } else if (document.querySelector(el)) {
      resolved = el
    } else {
      continue
    }
    const rect = document.querySelector(resolved)?.getBoundingClientRect()
    const side = rect && rect.right <= halfWindow ? "right" : "bottom"
    steps.push({ ...step, element: resolved, popover: { ...step.popover, side } })
  }
  return steps
}
