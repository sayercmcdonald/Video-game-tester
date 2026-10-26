-- Database-level guards for financial data. The application validates these
-- too; these constraints make bad data impossible even if a bug slips through.
ALTER TABLE "Donation" ADD CONSTRAINT "donation_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "Donation" ADD CONSTRAINT "donation_fee_nonnegative" CHECK ("feeCents" >= 0);
ALTER TABLE "Donation" ADD CONSTRAINT "donation_refund_bounds" CHECK ("refundedCents" >= 0 AND "refundedCents" <= "amountCents");
ALTER TABLE "Pledge" ADD CONSTRAINT "pledge_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "expense_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "BudgetLine" ADD CONSTRAINT "budget_line_nonnegative" CHECK ("plannedCents" >= 0);
ALTER TABLE "Campaign" ADD CONSTRAINT "campaign_goal_nonnegative" CHECK ("goalCents" >= 0);
ALTER TABLE "Trip" ADD CONSTRAINT "trip_money_nonnegative" CHECK ("budgetCents" >= 0 AND "fundraisingGoalCents" >= 0 AND "defaultParticipantGoalCents" >= 0);
ALTER TABLE "Trip" ADD CONSTRAINT "trip_dates_ordered" CHECK ("endDate" >= "startDate");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_amount_nonzero" CHECK ("amountCents" <> 0);

-- The ledger is append-only. Corrections are recorded as new entries.
CREATE OR REPLACE FUNCTION ledger_entry_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_no_update BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_immutable();

-- Audit history is append-only as well.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_immutable();
