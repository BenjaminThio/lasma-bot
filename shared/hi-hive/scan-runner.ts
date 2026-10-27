/**
 * scan-runner.ts — src/lib/hi-hive/scan-runner.ts
 *
 * The per-account scan pipeline, extracted so BOTH the live path and the
 * persisted buffer service can invoke it:
 *   1. validate the account really exists (profile id must match creds)
 *   2. skip if this class is already recorded as attended
 *   3. skip if the student isn't enrolled in the course
 *   4. optional smart-schedule skip (SMART_SCHEDULE_SKIP=1)
 *   5. otherwise submit the scan and map the server status
 *
 * SMART_SCHEDULE_SKIP=-1 is force mode: steps 2-4 (already recorded, not
 * enrolled incl. course aliases, schedule) are skipped and every verified
 * account scans whatever course the QR is for. Step 1 still runs so a QR is
 * never submitted under credentials that belong to someone else.
 */

import { scanQr } from "./scan-qr.js";
import type { ScanQrResult } from "./types.js";
import { validateAccount, buildScheduleSlots, matchesSchedule, isAlreadyRecorded } from "./account-validation.js";
import { canonicalCode } from "./course-aliases.js";
import { fromScanStatus, type ReportStatus } from "./scan-status.js";
import { decodeQr } from "./legacy/decode-qr.js";

// "1" = smart schedule skip, "-1" = force scan (no filters), anything else = normal
const SCHEDULE_MODE       = (process.env["SMART_SCHEDULE_SKIP"] ?? "").trim();
const SMART_SCHEDULE_SKIP = SCHEDULE_MODE === "1";
const FORCE_SCAN          = SCHEDULE_MODE === "-1";

if (FORCE_SCAN) console.log("[autoScan] SMART_SCHEDULE_SKIP=-1: force mode, course/enrolment/schedule filters are off");

/** Scan one account for one QR. Never throws — returns a ReportStatus. */
export async function scanOneAccount(
  docId: string,
  creds: any,
  label: string,
  extracted: string
): Promise<ReportStatus> {
  // Decode the QR for the course/time-based checks
  const decoded = decodeQr(docId, extracted);
  const qrInfo  = decoded.ok ? decoded.decoded.info : undefined;


    // ── Feature 1: account-existence validation ──────────────────────────
    // Fetch this account's attendance and confirm the profile Student ID
    // matches its credentials. A fake account (e.g. 999999) won't match.
    const check = await validateAccount(docId, creds.id);

    if (!check.exists) {
      console.log(`[autoScan] 🛑 ${label}: ${check.reason}`);
      return "account_unverified";
    }
    console.log(`[autoScan] ✔ ${label} verified: ${check.reason}`);

    if (FORCE_SCAN) console.log(`[autoScan] ⏩ ${label}: force mode, skipping course filters`);

    // ── Skip if this class is ALREADY recorded as attended ────────────────
    // Reuses the attendance we just fetched for validation (no extra call).
    if (!FORCE_SCAN && check.attendance && qrInfo?.courseCode && qrInfo?.datetime) {
      const already = isAlreadyRecorded(check.attendance, {
        courseCode:   qrInfo.courseCode,
        classDatetime: qrInfo.datetime,
        group:        qrInfo.group ?? "",
      });
      if (already.recorded) {
        console.log(`[autoScan] ☑️ ${label}: ${qrInfo.courseCode} @ ${qrInfo.datetime} already recorded — skipping`);
        return "already_marked";
      }
    }

    // ── Not-enrolled check ───────────────────────────────────────────────
    // If the student has attendance history (week 2+) and the scanned course
    // simply isn't among their enrolled courses, skip — they don't take it.
    // (Uses canonical codes, so dual-code classes like UECS2403/2103 count.)
    if (!FORCE_SCAN && qrInfo?.courseCode && check.enrolledCodes.size > 0) {
      const wantCode = canonicalCode(qrInfo.courseCode);
      if (!check.enrolledCodes.has(wantCode)) {
        console.log(`[autoScan] 🚫 ${label}: not enrolled in ${qrInfo.courseCode} (${wantCode})`);
        return "not_enrolled";
      }
    }

    // ── Feature 3 (optional): smart-schedule skip ────────────────────────
    if (SMART_SCHEDULE_SKIP && check.attendance && qrInfo?.courseCode && qrInfo?.datetime) {
      const slots = buildScheduleSlots(check.attendance);
      const fits = matchesSchedule(slots, {
        courseCode:   qrInfo.courseCode,
        classDatetime: qrInfo.datetime,
        group:        qrInfo.group ?? "",
      });
      if (!fits) {
        console.log(`[autoScan] 📭 ${label}: ${qrInfo.courseCode} @ ${qrInfo.datetime} not in known schedule`);
        return "not_in_schedule";
      }
    }

    // ── Submit the scan for THIS account ─────────────────────────────────
    const result: ScanQrResult | undefined = await scanQr(docId, extracted);

    if (result === undefined) {
      console.log(`[autoScan] ⚠️ ${label}: no result — creds likely corrupted.`);
      return "scan_failed";
    }

    const reportStatus = fromScanStatus(result.status);
    console.log(`[autoScan] ${label}: scan done (server=${result.status} → ${reportStatus})`);
    return reportStatus;
  
}