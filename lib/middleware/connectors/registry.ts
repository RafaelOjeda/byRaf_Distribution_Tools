import "server-only";
import type { MarketplaceConnector } from "./base";
import { WalmartConnector } from "./walmart/connector";

/**
 * Every marketplace the middleware knows about. Adding a marketplace
 * means adding one connector class plus one line here - see
 * docs/adding-a-marketplace.md.
 */
export const CONNECTORS: MarketplaceConnector[] = [new WalmartConnector()];

export function getConnector(id: string): MarketplaceConnector | undefined {
  return CONNECTORS.find((c) => c.descriptor.id === id);
}
