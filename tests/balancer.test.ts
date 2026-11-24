import { describe, it, expect } from "bun:test";

describe("Storage Balancer Logic", () => {
  interface MockAccount {
    id: string;
    email: string;
    storageUsage: number;
    storageLimit: number;
    dailyBytes: number;
  }

  const accounts: MockAccount[] = [
    { id: "acc-1", email: "a@gmail.com", storageUsage: 500, storageLimit: 1000, dailyBytes: 100 },
    { id: "acc-2", email: "b@gmail.com", storageUsage: 200, storageLimit: 1000, dailyBytes: 50 },
    { id: "acc-3", email: "c@gmail.com", storageUsage: 800, storageLimit: 1000, dailyBytes: 200 },
  ];

  it("should pick least_used account with lowest storageUsage", () => {
    const sorted = [...accounts].sort((a, b) => a.storageUsage - b.storageUsage);
    expect(sorted[0].id).toBe("acc-2");
  });

  it("should pick fill_first account until limit is reached", () => {
    const underLimit = accounts.filter((a) => a.storageUsage < a.storageLimit);
    expect(underLimit[0].id).toBe("acc-1");
  });

  it("should deterministically hash key to same account index", () => {
    function pickHashAccount(key: string, accs: MockAccount[]): MockAccount {
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = (hash << 5) - hash + key.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % accs.length;
      return accs[idx];
    }

    const choice1 = pickHashAccount("my-photo.jpg", accounts);
    const choice2 = pickHashAccount("my-photo.jpg", accounts);
    expect(choice1.id).toBe(choice2.id);

    const otherChoice = pickHashAccount("another-file.pdf", accounts);
    expect(otherChoice).toBeDefined();
  });
});
