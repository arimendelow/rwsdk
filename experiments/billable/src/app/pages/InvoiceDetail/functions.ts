"use server";
import {
  type Invoice,
} from "@prisma/client";
import { db } from "../../../db";
import { InvoiceItem, InvoiceTaxes } from "../../services/invoices";

export async function saveInvoice(id: string, invoice: Omit<Invoice, 'items' | 'taxes'>, items: InvoiceItem[], taxes: InvoiceTaxes[]) {

  // validate input with zod
  // validate user id.

  const data: Invoice = {
    ...invoice,
    items: JSON.stringify(items),
    taxes: JSON.stringify(taxes),
  }

  await db.invoice.upsert({
    create: data,
    update: data,
    where: {
      id,
    }
  })
}


export async function generatePdf(id: string) {
  return 'x'
}
