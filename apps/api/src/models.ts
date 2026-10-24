// src/models.ts — import every model so scripts (indexes, migration) register them all.
import "./audit/audit";
import "./counters/counters";
import "./users/user.model";
import "./orgs/org.model";
import "./orgs/membership.model";
import "./orgs/invitation.model";
import "./jobs/job.model";
import "./search/search-entry.model";
// plan 06 adds: leads, vendors, projects, rfqs, purchase orders, quotations, variation orders, invoices, files
// plan 07 adds: documents
