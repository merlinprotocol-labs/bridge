import { Chain } from "@renproject/chains";
import {
  Bitcoin,
  BitcoinBaseChain,
  BitcoinCash,
  Dogecoin,
  Zcash,
  DigiByte,
} from "@renproject/chains-bitcoin";
import { Terra } from "@renproject/chains-terra";

import {
  Arbitrum,
  Avalanche,
  BinanceSmartChain,
  Ethereum,
  EthProvider,
  EvmNetworkConfig,
  Fantom,
  Polygon,
  Goerli,
} from "@renproject/chains-ethereum";
import {
  Chain as GatewayChain,
  DepositChain,
  RenNetwork,
} from "@renproject/utils";
import { ethers, providers } from "ethers";
import { supportedEthereumChains } from "../../utils/chainsConfig";
import { EthereumBaseChain } from "../../utils/missingTypes";

export interface ChainInstance {
  chain: GatewayChain;
  connectionRequired?: boolean;
  accounts?: string[];
}

export type ChainInstanceMap = Record<Chain, ChainInstance>;
export type PartialChainInstanceMap = Partial<ChainInstanceMap>;

interface EVMConstructor<EVM> {
  configMap: {
    [network in RenNetwork]?: EvmNetworkConfig;
  };

  new ({
    network,
    provider,
  }: {
    network: RenNetwork;
    provider: EthProvider;
  }): EVM;
}

export const getEthereumBaseChain = <EVM extends EthereumBaseChain>(
  ChainClass: EVMConstructor<EVM>,
  network: RenNetwork
): ChainInstance & {
  chain: EVM;
} => {
  const config = ChainClass.configMap[network];
  if (!config) {
    throw new Error(`No configuration for ${ChainClass.name} on ${network}.`);
  }

  let rpcUrl = config.network.rpcUrls[0];
  if (process.env.REACT_APP_INFURA_KEY) {
    for (const url of config.network.rpcUrls) {
      if (url.match(/^https:\/\/.*\$\{INFURA_API_KEY\}/)) {
        rpcUrl = url.replace(
          /\$\{INFURA_API_KEY\}/,
          process.env.REACT_APP_INFURA_KEY
        );
        break;
      }
    }
  }

  const provider = new providers.JsonRpcProvider(rpcUrl);

  return {
    chain: new ChainClass({
      network,
      provider,
    }),
    connectionRequired: true,
    accounts: [],
  };
};

const getBitcoinBaseChain = <BTC extends BitcoinBaseChain>(ChainClass: BTC) => {
  return {
    chain: ChainClass,
  };
};

const getDepositBaseChain = <TRR extends DepositChain>(ChainClass: TRR) => {
  return {
    chain: ChainClass,
  };
};

export const getDefaultChains = (network: RenNetwork): ChainInstanceMap => {
  const ethereumBaseChains = {
    [Chain.Ethereum]: getEthereumBaseChain(Ethereum, network),
    [Chain.BinanceSmartChain]: getEthereumBaseChain(BinanceSmartChain, network),
    [Chain.Polygon]: getEthereumBaseChain(Polygon, network),
    [Chain.Goerli]: getEthereumBaseChain(Goerli, network),
    [Chain.Avalanche]: getEthereumBaseChain(Avalanche, network),
    [Chain.Arbitrum]: getEthereumBaseChain(Fantom, network),
    [Chain.Fantom]: getEthereumBaseChain(Arbitrum, network),
  };

  const bitcoinBaseChains = {
    [Chain.BitcoinCash]: getBitcoinBaseChain(new BitcoinCash({ network })),
    [Chain.Dogecoin]: getBitcoinBaseChain(new Dogecoin({ network })),
    [Chain.Bitcoin]: getBitcoinBaseChain(new Bitcoin({ network })),
    [Chain.Zcash]: getBitcoinBaseChain(new Zcash({ network })),
    [Chain.DigiByte]: getBitcoinBaseChain(new DigiByte({ network })),
  };

  const depositBaseChains = {
    // @ts-ignore
    [Chain.Terra]: getDepositBaseChain(new Terra({ network })),
  };
  return {
    ...ethereumBaseChains,
    ...bitcoinBaseChains,
    ...depositBaseChains,
  } as unknown as ChainInstanceMap;
};

export const alterEthereumBaseChainsProviderSigner = (
  chains: PartialChainInstanceMap,
  provider: any,
  alterProvider?: boolean,
  alteredChain?: Chain
) => {
  console.log(
    `altering provider signer`,
    provider,
    alteredChain ? alteredChain : "all chains"
  );
  const ethersProvider = new ethers.providers.Web3Provider(provider);
  const signer = ethersProvider.getSigner();
  // TODO: TBD: Noah : provider stays for the whole process, only signer changes?
  if (alterProvider) {
    console.log("altering provider", provider, alteredChain);
    alterEthereumBaseChainsProvider(chains, provider, alteredChain);
  }
  console.log("altering signer", signer, alteredChain);
  alterEthereumBaseChainsSigner(chains, signer, alteredChain);
};

export const alterEthereumBaseChainsSigner = (
  chains: PartialChainInstanceMap,
  signer: any,
  alteredChain?: Chain
) => {
  const alteredChains = alteredChain
    ? supportedEthereumChains.filter((chainName) => chainName === alteredChain)
    : supportedEthereumChains;
  alteredChains.forEach((chainName) => {
    if ((chains[chainName]?.chain as EthereumBaseChain).withSigner) {
      (chains[chainName]?.chain as EthereumBaseChain).withSigner!(signer);
      console.log("altered signer for", alteredChains.join(", "));
    } else {
      throw new Error(
        `Altering signer failed: Unable to find chain ${chainName} in chains ${Object.keys(
          chains
        ).join(", ")}`
      );
    }
  });
};

export const alterEthereumBaseChainsProvider = (
  chains: PartialChainInstanceMap,
  provider: any,
  alteredChain?: Chain
) => {
  const alteredChains = alteredChain
    ? supportedEthereumChains.filter((chainName) => chainName === alteredChain)
    : supportedEthereumChains;
  alteredChains.forEach((chainName) => {
    if ((chains[chainName]?.chain as EthereumBaseChain).withProvider) {
      (chains[chainName]?.chain as EthereumBaseChain).withProvider!(provider);
      console.log("altered provider for", alteredChains.join(", "));
    } else {
      throw new Error(
        `Altering provider failed. Unable to find chain ${chainName} in chains ${Object.keys(
          chains
        ).join(", ")}`
      );
    }
  });
};
