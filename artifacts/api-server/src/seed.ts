/**
 * Seed script — inserts sample data for every module.
 * Run with: pnpm --filter @workspace/api-server run seed
 */
import {
  db,
  usersTable,
  casesTable,
  caseActivitiesTable,
  documentsTable,
  documentVersionsTable,
  timeEntriesTable,
  invoicesTable,
  expensesTable,
  tasksTable,
  contractsTable,
  contractPaymentsTable,
  aiDraftsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("🌱 Seeding database…");

  // Clear in dependency order
  await db.execute(sql`TRUNCATE ai_drafts, contract_payments, contracts, tasks, expenses, invoices, time_entries, document_versions, documents, case_activities, cases, users RESTART IDENTITY CASCADE`);

  // ── Users ────────────────────────────────────────────────────────
  const [admin, lawyerSarah, lawyerOmar, paralegal] = await db.insert(usersTable).values([
    { name: "Ahmed Al-Humoudi", email: "ahmed@alhumoudi.law", role: "admin", barNumber: "SAR-001", specialization: "Corporate Law", billableRate: 500, active: true },
    { name: "Sarah Al-Rashidi", email: "sarah@alhumoudi.law", role: "lawyer", barNumber: "SAR-042", specialization: "Family Law", billableRate: 450, active: true },
    { name: "Omar Khalid", email: "omar@alhumoudi.law", role: "lawyer", barNumber: "SAR-078", specialization: "Criminal Defense", billableRate: 400, active: true },
    { name: "Lina Mahmoud", email: "lina@alhumoudi.law", role: "paralegal", specialization: "Legal Research", billableRate: 200, active: true },
  ]).returning();

  // ── Cases ────────────────────────────────────────────────────────
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  const [case1, case2, case3] = await db.insert(casesTable).values([
    {
      caseNumber: "ALH-0001", title: "Merger Agreement – Al-Noor Holdings", clientName: "Al-Noor Holdings LLC",
      clientEmail: "ceo@alnoor.sa", clientPhone: "+966 50 111 2222", caseType: "Corporate",
      status: "active", jurisdiction: "Riyadh Commercial Court", court: "First Circuit",
      opposingParty: "Crescent Capital Group", opposingCounsel: "Al-Farsi Law Firm",
      assignedLawyerId: admin.id, courtDate: fmt(addDays(today, 45)),
      statuteDeadline: fmt(addDays(today, 90)),
      description: "Complex merger advisory involving cross-border asset transfer and regulatory approvals.",
      retainerAmount: 50000,
    },
    {
      caseNumber: "ALH-0002", title: "Custody Dispute – Al-Sayegh", clientName: "Hessa Al-Sayegh",
      clientEmail: "hessa@gmail.com", clientPhone: "+966 55 333 4444", caseType: "Family",
      status: "active", jurisdiction: "Jeddah Family Court", court: "Chamber 3",
      assignedLawyerId: lawyerSarah.id, courtDate: fmt(addDays(today, 12)),
      description: "Child custody and asset division post-divorce proceedings.",
      retainerAmount: 15000,
    },
    {
      caseNumber: "ALH-0003", title: "Criminal Defense – Al-Otaibi", clientName: "Faisal Al-Otaibi",
      clientEmail: "faisal@personal.sa", caseType: "Criminal",
      status: "open", jurisdiction: "Dammam Criminal Court",
      assignedLawyerId: lawyerOmar.id,
      statuteDeadline: fmt(addDays(today, 30)),
      description: "Defense on commercial fraud charges. Evidence review in progress.",
      retainerAmount: 25000,
    },
  ]).returning();

  // ── Case Activities ───────────────────────────────────────────────
  await db.insert(caseActivitiesTable).values([
    { caseId: case1.id, activityType: "note", description: "Initial client consultation completed. Retainer signed.", performedById: admin.id },
    { caseId: case1.id, activityType: "court_hearing", description: "Preliminary hearing scheduled at Riyadh Commercial Court.", performedById: admin.id },
    { caseId: case2.id, activityType: "note", description: "Collected financial statements and child school records.", performedById: lawyerSarah.id },
    { caseId: case3.id, activityType: "document_uploaded", description: "Police report and indictment documents received.", performedById: lawyerOmar.id },
  ]);

  // ── Documents ─────────────────────────────────────────────────────
  const [doc1] = await db.insert(documentsTable).values(
    { caseId: case1.id, title: "Draft Merger Agreement v1", description: "Initial draft for client review", fileType: "pdf", filePath: "/uploads/merger-draft-v1.pdf", status: "draft", version: 2, uploadedById: admin.id, tags: "merger,draft" }
  ).returning();
  await db.insert(documentsTable).values(
    { caseId: case1.id, title: "Due Diligence Report", description: "Full due diligence on Crescent Capital assets", fileType: "docx", filePath: "/uploads/due-diligence.docx", status: "final", version: 1, uploadedById: paralegal.id, tags: "due-diligence" }
  );
  await db.insert(documentsTable).values(
    { caseId: case2.id, title: "Custody Agreement Draft", description: "Initial custody proposal", fileType: "pdf", filePath: "/uploads/custody-draft.pdf", status: "draft", version: 1, uploadedById: lawyerSarah.id, tags: "custody,family" }
  );
  await db.insert(documentsTable).values(
    { caseId: case3.id, title: "Police Report", description: "Official police report from Dammam PD", fileType: "pdf", filePath: "/uploads/police-report.pdf", status: "final", version: 1, uploadedById: lawyerOmar.id, tags: "evidence,criminal" }
  );

  await db.insert(documentVersionsTable).values([
    { documentId: doc1.id, version: 1, changeNote: "Initial upload", editedById: admin.id },
  ]);

  // ── Time Entries ──────────────────────────────────────────────────
  await db.insert(timeEntriesTable).values([
    { caseId: case1.id, lawyerId: admin.id, hours: 4.5, hourlyRate: 500, date: fmt(addDays(today, -5)), description: "Client meeting + merger strategy session", isBillable: true, invoiced: false },
    { caseId: case1.id, lawyerId: admin.id, hours: 6.0, hourlyRate: 500, date: fmt(addDays(today, -3)), description: "Review of Crescent Capital financials", isBillable: true, invoiced: false },
    { caseId: case1.id, lawyerId: paralegal.id, hours: 8.0, hourlyRate: 200, date: fmt(addDays(today, -3)), description: "Due diligence document compilation", isBillable: true, invoiced: true },
    { caseId: case2.id, lawyerId: lawyerSarah.id, hours: 3.0, hourlyRate: 450, date: fmt(addDays(today, -7)), description: "Initial client interview and case assessment", isBillable: true, invoiced: false },
    { caseId: case2.id, lawyerId: lawyerSarah.id, hours: 2.5, hourlyRate: 450, date: fmt(addDays(today, -2)), description: "Custody agreement drafting", isBillable: true, invoiced: false },
    { caseId: case3.id, lawyerId: lawyerOmar.id, hours: 5.0, hourlyRate: 400, date: fmt(addDays(today, -10)), description: "Evidence review and defense strategy", isBillable: true, invoiced: false },
  ]);

  // ── Invoices ──────────────────────────────────────────────────────
  await db.insert(invoicesTable).values([
    {
      caseId: case1.id, invoiceNumber: "INV-0001", clientName: case1.clientName,
      totalAmount: 1600, paidAmount: 0, retainerApplied: 0, status: "sent",
      issuedDate: fmt(addDays(today, -10)), dueDate: fmt(addDays(today, 20)),
      notes: "Due diligence phase – paralegal hours",
    },
    {
      caseId: case2.id, invoiceNumber: "INV-0002", clientName: case2.clientName,
      totalAmount: 2475, paidAmount: 2475, retainerApplied: 0, status: "paid",
      issuedDate: fmt(addDays(today, -20)), dueDate: fmt(addDays(today, -5)),
      paidDate: fmt(addDays(today, -8)), notes: "Initial consultation and court filing fees",
    },
  ]);

  // ── Expenses ──────────────────────────────────────────────────────
  await db.insert(expensesTable).values([
    { caseId: case1.id, category: "Court Fees", amount: 1500, description: "Commercial court filing fee", date: fmt(addDays(today, -15)), submittedById: admin.id, billable: true },
    { caseId: case1.id, category: "Translation", amount: 800, description: "English-Arabic merger document translation", date: fmt(addDays(today, -8)), submittedById: paralegal.id, billable: true },
    { caseId: case2.id, category: "Court Fees", amount: 600, description: "Family court filing", date: fmt(addDays(today, -18)), submittedById: lawyerSarah.id, billable: true },
    { caseId: case3.id, category: "Expert Witness", amount: 3000, description: "Forensic accountant fee – fraud analysis", date: fmt(addDays(today, -5)), submittedById: lawyerOmar.id, billable: true },
  ]);

  // ── Tasks ─────────────────────────────────────────────────────────
  await db.insert(tasksTable).values([
    { title: "Finalize merger agreement draft", caseId: case1.id, assigneeId: admin.id, createdById: admin.id, status: "in_progress", priority: "high", dueDate: fmt(addDays(today, 7)) },
    { title: "File preliminary motion", caseId: case2.id, assigneeId: lawyerSarah.id, createdById: lawyerSarah.id, status: "pending", priority: "urgent", dueDate: fmt(addDays(today, 3)) },
    { title: "Review prosecution evidence bundle", caseId: case3.id, assigneeId: lawyerOmar.id, createdById: lawyerOmar.id, status: "pending", priority: "high", dueDate: fmt(addDays(today, 5)) },
    { title: "Update client retainer billing", assigneeId: paralegal.id, createdById: admin.id, status: "pending", priority: "normal", dueDate: fmt(addDays(today, 14)) },
    { title: "Prepare quarterly billing report", assigneeId: paralegal.id, createdById: admin.id, status: "done", priority: "normal", dueDate: fmt(addDays(today, -2)), completedAt: addDays(today, -1) },
  ]);

  // ── Contracts ─────────────────────────────────────────────────────
  const [contract1] = await db.insert(contractsTable).values([
    {
      contractNumber: "CTR-0001", title: "Annual Legal Retainer – Al-Noor Holdings",
      clientName: "Al-Noor Holdings LLC", caseId: case1.id, status: "active",
      contractType: "Retainer", totalValue: 120000,
      startDate: fmt(addDays(today, -30)), endDate: fmt(addDays(today, 335)),
      responsibleLawyerId: admin.id, description: "Annual retainer for all corporate legal matters.",
    },
    {
      contractNumber: "CTR-0002", title: "Family Case Fixed Fee – Hessa Al-Sayegh",
      clientName: "Hessa Al-Sayegh", caseId: case2.id, status: "active",
      contractType: "Fixed Fee", totalValue: 15000,
      startDate: fmt(addDays(today, -25)), endDate: fmt(addDays(today, 60)),
      responsibleLawyerId: lawyerSarah.id, description: "Fixed fee engagement for custody proceedings.",
    },
  ]).returning();

  await db.insert(contractPaymentsTable).values([
    { contractId: contract1.id, amount: 10000, dueDate: fmt(today), status: "pending", notes: "Monthly retainer instalment – August" },
    { contractId: contract1.id, amount: 10000, dueDate: fmt(addDays(today, 30)), status: "pending", notes: "Monthly retainer instalment – September" },
  ]);

  // ── AI Drafts ─────────────────────────────────────────────────────
  await db.insert(aiDraftsTable).values([
    {
      title: "Settlement Proposal – Merger Dispute Clause", draftType: "contract_clause",
      status: "pending_approval",
      content: `SETTLEMENT AND RELEASE\n\nThis Settlement Agreement ("Agreement") is entered into by and between Al-Noor Holdings LLC ("Client") and Crescent Capital Group ("Counterparty").\n\n1. SETTLEMENT AMOUNT. The Counterparty agrees to pay SAR 2,500,000 as full and final settlement.\n2. RELEASE OF CLAIMS. Upon receipt of payment, Client releases all claims arising from the merger negotiations.\n3. CONFIDENTIALITY. Both parties agree to maintain strict confidentiality regarding the terms of this Agreement.\n\n[DRAFT – PENDING PARTNER REVIEW]`,
      caseId: case1.id, createdById: paralegal.id,
    },
    {
      title: "Custody Arrangement Proposal", draftType: "court_brief",
      status: "approved",
      content: `IN THE FAMILY COURT OF JEDDAH\n\nCASE NO: JED-FAM-2026-0842\n\nPROPOSED CUSTODY ARRANGEMENT\n\nThe parties agree that the best interests of the minor child shall govern all arrangements.\n\nPRIMARY CUSTODY: Mother (Hessa Al-Sayegh)\nVISITATION: Father - every other weekend and school holidays\nFINANCIAL SUPPORT: SAR 5,000/month child support\n\n[APPROVED BY PARTNER ON ${fmt(addDays(today, -3))}]`,
      caseId: case2.id, createdById: paralegal.id, reviewedById: lawyerSarah.id,
      reviewedAt: addDays(today, -3), reviewNotes: "Approved with minor formatting edits.", editsMadeBeforeApproval: "Adjusted payment figures and formatting per partner review.",
    },
    {
      title: "Motion to Suppress Evidence", draftType: "court_brief",
      status: "pending_approval",
      content: `IN THE CRIMINAL COURT OF DAMMAM\n\nMOTION TO SUPPRESS EVIDENCE\n\nDefendant Faisal Al-Otaibi, through counsel, respectfully moves this Court to suppress all evidence obtained during the search conducted on March 15, 2026.\n\nGROUNDS:\n1. The search warrant was issued without probable cause.\n2. Evidence was collected beyond the scope of the warrant.\n3. Chain of custody was not properly maintained.\n\nFor the foregoing reasons, Defendant respectfully requests that this Court suppress the identified evidence.\n\n[AI DRAFT – REQUIRES ATTORNEY REVIEW]`,
      caseId: case3.id, createdById: lawyerOmar.id,
    },
  ]);

  console.log("✅ Seed complete!");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
