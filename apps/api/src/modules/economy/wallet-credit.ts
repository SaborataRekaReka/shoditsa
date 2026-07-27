export type PositiveWalletCredit = {
  grossAmount: number
  spendableAmount: number
  debtAdded: 0
  debtSettled: number
  balanceAfter: number
  purchaseDebtAfter: number
}

export const settlePositiveWalletCredit = (
  wallet: { balance: number; purchaseDebt: number },
  grossCredit: number,
): PositiveWalletCredit => {
  const grossAmount = Math.max(0, Math.trunc(grossCredit))
  const debtSettled = Math.min(wallet.purchaseDebt, grossAmount)
  const spendableAmount = grossAmount - debtSettled
  return {
    grossAmount,
    spendableAmount,
    debtAdded: 0,
    debtSettled,
    balanceAfter: wallet.balance + spendableAmount,
    purchaseDebtAfter: wallet.purchaseDebt - debtSettled,
  }
}

export const walletCreditMetadata = (
  credit: PositiveWalletCredit,
  extra: Record<string, unknown> = {},
) => ({
  grossAmount: credit.grossAmount,
  spendableAmount: credit.spendableAmount,
  debtAdded: credit.debtAdded,
  debtSettled: credit.debtSettled,
  ...extra,
})
