/*
  Warnings:

  - A unique constraint covering the columns `[txSig]` on the table `Expense` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "txSig" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_txSig_key" ON "Expense"("txSig");
