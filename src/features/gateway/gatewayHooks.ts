import { Asset, Chain } from "@renproject/chains";
import { Ethereum } from "@renproject/chains-ethereum";
import RenJS, { Gateway, GatewayTransaction } from "@renproject/ren";
import { InputType, OutputType, RenNetwork } from "@renproject/utils";
import BigNumber from "bignumber.js";
import { ethers } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { alterEthereumBaseChainSigner } from "../chain/chainUtils";
import { $exchangeRates } from "../marketData/marketDataSlice";
import { findAssetExchangeRate } from "../marketData/marketDataUtils";
import { useChains } from "../network/networkHooks";
import { useWallet } from "../wallet/walletHooks";
import { createGateway } from "./gatewayUtils";

type UseGatewayParams = {
  network: RenNetwork;
  asset: Asset;
  from: Chain;
  to: Chain;
  amount?: string;
  nonce?: number;
};

export const useGateway = ({
  asset,
  from,
  to,
  amount,
  network,
  nonce,
}: UseGatewayParams) => {
  const chains = useChains(network);
  const { provider } = useWallet(to);
  const [renJs, setRenJs] = useState<RenJS | null>(null);
  const [error, setError] = useState(null);
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [transactions, setTransactions] = useState<Array<GatewayTransaction>>(
    []
  );
  const addTransaction = useCallback((tx: GatewayTransaction) => {
    console.log("gateway detected transaction", tx);
    setTransactions((txs) => [...txs, tx]);
  }, []);

  // set up renjs with signers
  useEffect(() => {
    console.log("useGateway useEffect renJs and provider");
    const initProvider = async () => {
      const ethersProvider = new ethers.providers.Web3Provider(provider);
      const signer = ethersProvider.getSigner();
      console.log("useGateway altering signer");
      alterEthereumBaseChainSigner(chains, signer);
      const renJs = new RenJS(network).withChains(
        // @ts-ignore
        ...Object.values(chains).map((chain) => chain.chain)
      );
      (window as any).renJs = renJs;
      return renJs;
    };
    initProvider()
      .then((renJs) => setRenJs(renJs))
      .catch((error) => {
        setError(error);
      });
  }, [network, chains, provider]);

  // initialize gateway
  useEffect(() => {
    console.log("useGateway useEffect gateway init");
    if (renJs) {
      const initializeGateway = async () => {
        const gateway = await createGateway(
          renJs,
          { asset, from, to, amount, nonce },
          chains
        );
        console.log("gateway created", gateway);
        gateway.on("transaction", addTransaction);
        console.log("gateway transaction listener added");
        (window as any).gateway = gateway;
        return gateway;
      };
      console.log("gateway initializing");
      initializeGateway()
        .then((gateway) => setGateway(gateway))
        .catch((error) => {
          setError(error);
        });
    }

    return () => {
      if (gateway) {
        console.log("gateway removing listeners");
        gateway.eventEmitter.removeAllListeners();
      }
    };
  }, [renJs]);

  return { renJs, gateway, transactions, error };
};

export const useGatewayFees = (
  gateway: Gateway | null,
  amount: string | number | BigNumber | null
) => {
  const [decimals, setDecimals] = useState(0);
  const [balancePending, setBalancePending] = useState(false);
  const [balance, setBalance] = useState("");
  const [minimumAmount, setMinimumAmount] = useState("");
  const [outputAmount, setOutputAmount] = useState<string | null>(null);
  const [mintFeePercent, setMintFeePercent] = useState<number | null>(null);
  const [burnFeePercent, setBurnFeePercent] = useState<number | null>(null);
  const [renVMFeePercent, setRenVMFeePercent] = useState<number | null>(null);
  const [renVMFeeAmount, setRenVMFeeAmount] = useState<string | null>(null);
  const [fromChainFeeAmount, setFromChainFeeAmount] = useState<string | null>(
    null
  );
  const [toChainFeeAmount, setToChainFeeAmount] = useState<string | null>(null);
  const [fromChainFeeAsset, setFromChainFeeAsset] = useState<Asset | null>(
    null
  );
  const [toChainFeeAsset, setToChainFeeAsset] = useState<Asset | null>(null);

  useEffect(() => {
    setBalancePending(true);
    //investigate this is flickering 3 times
    if (!gateway) {
      return;
    }
    const getBalance = async () => {
      const decimals = await gateway.fromChain.assetDecimals(
        gateway.params.asset
      );
      setDecimals(decimals);
      console.log(
        `gateway decimals ${gateway.fromChain.chain}/${gateway.params.asset}: ${decimals}`
      );

      const balanceBn = (
        await (gateway.toChain as Ethereum).getBalance(gateway.params.asset)
      ).shiftedBy(-decimals);
      setBalance(balanceBn.toFixed());
      console.log(`gateway balance: ${balanceBn}`);
      setBalancePending(false);
    };
    getBalance().catch(console.error);
  }, [gateway]);

  useEffect(() => {
    console.log(`gateway amounts effect`, gateway, amount);
    if (!gateway || !decimals) {
      return;
    }
    const isLock = gateway.inputType === InputType.Lock;
    const isMint = gateway.outputType === OutputType.Mint;
    console.log("amount", amount, isNaN(Number(amount)));
    if (amount === "" || amount === null || isNaN(Number(amount))) {
      setOutputAmount(null);
      setRenVMFeeAmount(null);
      return;
    }
    const amountBn = new BigNumber(amount);

    const estimatedOutputBn = gateway.fees
      // @ts-ignore
      .estimateOutput(amountBn.shiftedBy(decimals))
      .shiftedBy(-decimals);
    setOutputAmount(estimatedOutputBn.toFixed());
    console.log(`gateway amount estimated output: ${estimatedOutputBn}`);

    setMintFeePercent(
      new BigNumber(gateway.fees.mint).div(10000).multipliedBy(100).toNumber()
    );
    setBurnFeePercent(
      new BigNumber(gateway.fees.burn).div(10000).multipliedBy(100).toNumber()
    );
    const renVMFee = isMint ? gateway.fees.mint : gateway.fees.burn;
    const renVMFeePercentBn = new BigNumber(renVMFee)
      .div(10000)
      .multipliedBy(100);
    setRenVMFeePercent(renVMFeePercentBn.toNumber());
    const renVMFeeAmountBn = renVMFeePercentBn.div(100).multipliedBy(amountBn);
    setRenVMFeeAmount(renVMFeeAmountBn.toFixed());

    const minimumAmountBn = gateway.fees.minimumAmount.shiftedBy(-decimals);
    setMinimumAmount(minimumAmountBn.toFixed());
    console.log(`gateway amount minimum: ${minimumAmountBn}`);

    const fromChainFeeBn = isLock ? gateway.fees.lock : gateway.fees.release;
    setFromChainFeeAmount(fromChainFeeBn.shiftedBy(-decimals).toFixed());

    const toChainFeeBn = isLock ? gateway.fees.release : gateway.fees.lock;
    setToChainFeeAmount(toChainFeeBn.shiftedBy(-decimals).toFixed());

    const feeAssets = getNativeFeeAssets(gateway);
    setFromChainFeeAsset(feeAssets.fromChainFeeAsset);
    setToChainFeeAsset(feeAssets.toChainFeeAsset);
  }, [gateway, decimals, amount]);

  return {
    balancePending,
    decimals,
    balance,
    minimumAmount,
    outputAmount,
    mintFeePercent,
    burnFeePercent,
    renVMFeePercent,
    renVMFeeAmount,
    fromChainFeeAmount,
    fromChainFeeAsset,
    toChainFeeAmount,
    toChainFeeAsset,
    fees: gateway?.fees, // TODO: remove
  };
};

//TODO: crit finish when field ready Noah
const getNativeFeeAssets = (gateway: Gateway) => {
  return {
    fromChainFeeAsset: Object.values(gateway.fromChain.assets)[0] as Asset,
    toChainFeeAsset: Object.values(gateway.toChain.assets)[0] as Asset,
  };
};

export const useGatewayFeesWithRates = (
  gateway: Gateway | null,
  amount: string | number | BigNumber
) => {
  const rates = useSelector($exchangeRates);
  const fees = useGatewayFees(gateway, amount);
  const [balanceUsd, setBalanceUsd] = useState<string | null>(null);
  const [outputAmountUsd, setOutputAmountUsd] = useState<string | null>(null);
  const [minimumAmountUsd, setMinimumAmountUsd] = useState<string | null>(null);
  const [renVMFeeAmountUsd, setRenVMFeeAmountUsd] = useState<string | null>(
    null
  );
  const [fromChainFeeAmountUsd, setFromChainFeeAmountUsd] = useState<
    string | null
  >(null);
  const [toChainFeeAmountUsd, setToChainFeeAmountUsd] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (gateway === null || !gateway?.params?.asset) {
      return;
    }
    const asset = gateway.params.asset as Asset;
    const assetUsdRate = findAssetExchangeRate(rates, asset);
    console.log("assetUsdRate", assetUsdRate);
    if (assetUsdRate === null) {
      return;
    }
    setBalanceUsd(
      new BigNumber(fees.balance).multipliedBy(assetUsdRate).toFixed()
    );
    setOutputAmountUsd(
      fees.outputAmount !== null
        ? new BigNumber(fees.outputAmount).multipliedBy(assetUsdRate).toFixed()
        : null
    );
    setMinimumAmountUsd(
      new BigNumber(fees.minimumAmount).multipliedBy(assetUsdRate).toFixed()
    );
    setRenVMFeeAmountUsd(
      fees.renVMFeeAmount !== null
        ? new BigNumber(fees.renVMFeeAmount)
            .multipliedBy(assetUsdRate)
            .toFixed()
        : null
    );

    if (fees.fromChainFeeAsset !== null) {
      const fromChainAssetUsdRate = findAssetExchangeRate(
        rates,
        fees.fromChainFeeAsset
      );
      setFromChainFeeAmountUsd(
        fees.fromChainFeeAmount !== null && fromChainAssetUsdRate !== null
          ? new BigNumber(fees.fromChainFeeAmount)
              .multipliedBy(fromChainAssetUsdRate)
              .toFixed()
          : null
      );
    }
    if (fees.toChainFeeAsset !== null) {
      const toChainAssetUsdRate = findAssetExchangeRate(
        rates,
        fees.toChainFeeAsset
      );
      setToChainFeeAmountUsd(
        fees.toChainFeeAmount !== null && toChainAssetUsdRate !== null
          ? new BigNumber(fees.toChainFeeAmount)
              .multipliedBy(toChainAssetUsdRate)
              .toFixed()
          : null
      );
    }
  }, [gateway, amount, fees, rates]);

  return {
    ...fees,
    balanceUsd,
    outputAmountUsd,
    minimumAmountUsd,
    renVMFeeAmountUsd,
    fromChainFeeAmountUsd,
    toChainFeeAmountUsd,
  };
};
