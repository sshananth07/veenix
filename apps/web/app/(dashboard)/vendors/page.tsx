import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Store, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { VendorFormDialog } from "@/components/vendors/VendorFormDialog";
import { VendorSearchFilter } from "@/components/vendors/VendorSearchFilter";

export const dynamic = "force-dynamic";

type Search = { q?: string; trade?: string; status?: string };

export default async function VendorsPage({ searchParams }: { searchParams: Search }) {
  const q = (searchParams.q ?? "").trim();
  const where: Prisma.VendorWhereInput = {
    AND: [
      searchParams.trade ? { type: { contains: searchParams.trade } } : {},
      searchParams.status === "active" ? { active: true } : searchParams.status === "inactive" ? { active: false } : {},
      q ? { OR: [{ name: { contains: q } }, { type: { contains: q } }, { location: { contains: q } }] } : {},
    ],
  };

  const [vendors, all] = await Promise.all([
    prisma.vendor.findMany({ where, include: { purchaseOrders: true }, orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ select: { type: true } }),
  ]);
  const trades = [...new Set(all.flatMap((v) => (v.type ?? "").split(",").map((t) => t.trim()).filter(Boolean)))].sort();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendors</h1>
          <p className="mt-1 text-muted-foreground">Your trusted partners for quality work.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <VendorSearchFilter trades={trades} />
        <VendorFormDialog />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {vendors.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="h-6 w-6" />
            </span>
            <p className="mt-3 font-semibold">{all.length === 0 ? "No vendors yet" : "No vendors match your search"}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{all.length === 0 ? "Add your first vendor to start sending RFQs." : "Try a different search or clear the filters."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Vendor name</th>
                  <th className="px-3 py-3 font-medium">Trade</th>
                  <th className="px-3 py-3 font-medium">Jobs with us</th>
                  <th className="px-3 py-3 font-medium">Active POs</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vendors.map((v) => {
                  const activePOs = v.purchaseOrders.filter((po) => po.status !== "PAID").length;
                  return (
                    <tr key={v.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Store className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <Link href={`/vendors/${v.id}`} className="font-semibold hover:text-primary hover:underline">
                              {v.name}
                            </Link>
                            <div className="truncate text-xs text-muted-foreground">{v.type ?? "-"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">{v.type ?? <span className="text-muted-foreground">-</span>}</td>
                      <td className="px-3 py-3.5 tabular-nums">{v.jobsCount}</td>
                      <td className="px-3 py-3.5 tabular-nums">{activePOs}</td>
                      <td className="px-3 py-3.5">
                        <Badge variant={v.active ? "success" : "outline"}>{v.active ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/vendors/${v.id}`} className="text-sm font-medium text-primary hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
