import { z } from "zod";
import { clientTerms } from "./quotations";

export const scheduleInput = z.strictObject({ terms: clientTerms });