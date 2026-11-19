import { describe, expect, it } from "vitest";

import { chosenOffer } from "./app.ts";
import { loginPage, paymentReturnPage, visitorDevice } from "./pages.ts";

describe("a visitor who picks a plan before having an account", () => {
  it("sees the plan they chose while signing in", () => {
    expect(chosenOffer("/pay?plan=pro&cycle=month")).toEqual({ name: "Forfait Pro", price: "49 $/mois" });
    expect(chosenOffer("/pay?plan=trial")).toEqual({ name: "Essai Deliobot 3 jours", price: "5 $" });
    expect(chosenOffer("/pay?plan=toString")).toBeUndefined();
    expect(chosenOffer("/abonnement")).toBeUndefined();
    const page = loginPage("/pay?plan=pro&cycle=month", undefined, chosenOffer("/pay?plan=pro&cycle=month")).html;
    expect(page).toContain("Créez votre compte ou connectez-vous");
    expect(page).toContain("Forfait Pro");
  });

  it("is offered the download after paying, for their own computer", () => {
    expect(paymentReturnPage("paid", visitorDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).html).toContain("/download/Deliobot-Setup.exe");
    expect(paymentReturnPage("paid", visitorDevice("Mozilla/5.0 (X11; Linux x86_64)")).html).toContain("/download/Deliobot.deb");
    const phone = paymentReturnPage("pending", visitorDevice("Mozilla/5.0 (Linux; Android 14) Mobile")).html;
    expect(phone).toContain("Ouvrez deliobot.fun sur votre ordinateur");
    expect(phone).not.toContain("/download/");
    expect(paymentReturnPage("failed").html).not.toContain("Pas encore l'application");
  });
});
