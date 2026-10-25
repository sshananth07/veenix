export { MY_STATES, addressLines, composeAddress, hasStructuredAddress, isPostcode, type AddressParts } from "@veenix/shared";

// Reads the address fields out of a form. The API checks them. For a required
// address, blanks go as "" so the API answers with its own message ("City is required").
export function parseAddress(formData: FormData, required = false) {
  const get = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const must = (k: string) => (required ? get(k) ?? "" : get(k));
  return {
    addressLine1: must("addressLine1"),
    addressLine2: get("addressLine2"),
    addressLine3: get("addressLine3"),
    postcode: must("postcode"),
    city: must("city"),
    state: must("state"),
  };
}
