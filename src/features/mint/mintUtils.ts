import { RenNetwork } from "@renproject/interfaces";
import { useMultiwallet } from "@renproject/multiwallet-ui";
import { GatewaySession, mintMachine } from "@renproject/ren-tx";
import { useMachine } from "@xstate/react";
import { useEffect } from "react";
import { useSelector } from "react-redux";
import { env } from "../../constants/environmentVariables";
import { db } from "../../services/database/database";
import { getRenJs } from "../../services/renJs";
import { lockChainMap, mintChainMap } from "../../services/rentx";
import {
  BridgeChain,
  BridgeCurrency,
  getChainConfig,
  getChainConfigByRentxName,
  getChainRentxName,
  getCurrencyConfig,
  getCurrencyConfigByRentxName,
  getCurrencyRentxName,
  getCurrencyRentxSourceChain,
  getNetworkConfigByRentxName,
  toMintedCurrency,
} from "../../utils/assetConfigs";
import { $network } from "../network/networkSlice";
import {
  getChainExplorerLink,
  isTxExpired,
  TxPhase,
  TxEntryStatus,
  TxMeta,
} from "../transactions/transactionsUtils";

type CreateMintTransactionParams = {
  amount: number;
  currency: BridgeCurrency;
  mintedCurrency: BridgeCurrency; // TODO: Can be probably derived from mintedCurrencyChain
  mintedCurrencyChain: BridgeChain;
  userAddress: string;
  destAddress: string;
  network: RenNetwork;
};

export const createMintTransaction = ({
  amount,
  currency,
  mintedCurrencyChain,
  userAddress,
  destAddress,
  network,
}: CreateMintTransactionParams) => {
  const tx: GatewaySession = {
    id: "tx-" + Math.floor(Math.random() * 10 ** 16),
    type: "mint",
    network,
    sourceAsset: getCurrencyRentxName(currency),
    sourceChain: getCurrencyRentxSourceChain(currency),
    destAddress,
    destChain: getChainRentxName(mintedCurrencyChain),
    targetAmount: Number(amount),
    userAddress,
    expiryTime: new Date().getTime() + 1000 * 60 * 60 * 24,
    transactions: {},
    customParams: {},
  };

  return tx;
};

export const preValidateMintTransaction = (tx: GatewaySession) => {
  // TODO: create advancedValidation
  return (
    tx.type === "mint" &&
    tx.destAddress &&
    tx.userAddress &&
    tx.targetAmount > 0
  );
};

export const useMintMachine = (mintTransaction: GatewaySession) => {
  const { enabledChains } = useMultiwallet();
  const network = useSelector($network);
  const providers = Object.entries(enabledChains).reduce(
    (c, n) => ({
      ...c,
      [n[0]]: n[1].provider,
    }),
    {}
  );
  return useMachine(mintMachine, {
    context: {
      tx: mintTransaction,
      providers,
      sdk: getRenJs(network),
      fromChainMap: lockChainMap,
      toChainMap: mintChainMap,
    },
    devTools: env.XSTATE_DEVTOOLS,
  });
};

export const getLockAndMintParams = (tx: GatewaySession) => {
  const networkConfig = getNetworkConfigByRentxName(tx.network);
  const lockCurrencyConfig = getCurrencyConfigByRentxName(tx.sourceAsset);
  const mintCurrencyConfig = getCurrencyConfig(
    toMintedCurrency(lockCurrencyConfig.symbol)
  );
  const lockChainConfig = getChainConfig(lockCurrencyConfig.sourceChain);
  const mintChainConfig = getChainConfigByRentxName(tx.destChain);

  const transaction = Object.values(tx.transactions)[0];
  let mintTxHash: string = "";
  let mintTxLink: string = "";
  if (transaction && transaction.destTxHash) {
    mintTxHash = transaction.destTxHash;
    mintTxLink =
      getChainExplorerLink(
        mintChainConfig.symbol,
        networkConfig.symbol,
        transaction.destTxHash || ""
      ) || "";
  }
  let lockTxHash: string = "";
  let lockTxLink: string = "";
  let lockTxAmount = 0;
  let lockProcessingTime = null;
  let lockConfirmations = 0;
  let lockTargetConfirmations = 0;
  if (transaction) {
    lockTxAmount = transaction.sourceTxAmount / 1e8;
    if (transaction.rawSourceTx) {
      lockTxHash = transaction.rawSourceTx.transaction.txHash;
      lockTxLink =
        getChainExplorerLink(
          lockChainConfig.symbol,
          networkConfig.symbol,
          lockTxHash
        ) || "";
    }
    lockConfirmations = transaction.sourceTxConfs;
    if (transaction.sourceTxConfTarget) {
      lockTargetConfirmations = transaction.sourceTxConfTarget;
      lockProcessingTime =
        Math.max(lockTargetConfirmations - lockConfirmations, 0) *
        lockChainConfig.blockTime;
    }
  }
  const meta: TxMeta = {
    status: TxEntryStatus.PENDING,
    phase: TxPhase.NONE,
  };
  if (isTxExpired(tx)) {
    meta.status = TxEntryStatus.EXPIRED;
  } else if (lockTxHash) {
    if (mintTxHash) {
      meta.status = TxEntryStatus.COMPLETED;
    } else if (lockConfirmations >= lockTargetConfirmations) {
      meta.status = TxEntryStatus.ACTION_REQUIRED;
      meta.phase = TxPhase.MINT;
    }
  } else {
    meta.status = TxEntryStatus.ACTION_REQUIRED;
    meta.phase = TxPhase.LOCK;
  }
  return {
    networkConfig,
    mintCurrencyConfig,
    lockCurrencyConfig,
    mintChainConfig,
    lockChainConfig,
    mintTxHash,
    mintTxLink,
    lockTxHash,
    lockTxLink,
    lockConfirmations,
    lockTargetConfirmations,
    lockProcessingTime,
    lockTxAmount,
    suggestedAmount: Number(tx.suggestedAmount) / 1e8,
    meta,
  };
};

export enum DepositStates {
  restoringDeposit = "restoringDeposit",
  errorRestoring = "errorRestoring",
  restoredDeposit = "restoredDeposit",
  srcSettling = "srcSettling",
  srcConfirmed = "srcConfirmed",
  accepted = "accepted",
  claiming = "claiming",
  destInitiated = "destInitiated",
  completed = "completed",
  rejected = "rejected",
}

export const useMintTransactionPersistence = (
  tx: GatewaySession,
  state: DepositStates
) => {
  useEffect(() => {
    db.getTx(tx).then((data) => {
      console.log("data", data);
    });
  }, [tx, state]);
};
