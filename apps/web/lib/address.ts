export { MY_STATES, addressLines, composeAddress, hasStructuredAddress, isPostcode, type AddressParts } from "@veenix/shared";

// Reads the address fields out of a form. The API checks them.
export function parseAddress(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "").trim() || null;
  return {
    addressLine1: get("addressLine1"),
    addressLine2: get("addressLine2"),
    addressLine3: get("addressLine3"),
    postcode: get("postcode"),
    city: get("city"),
    state: get("state"),
  };
}
