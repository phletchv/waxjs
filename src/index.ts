import { Api, JsonRpc } from "eosjs";
import {
  SignatureProvider,
  Transaction,
} from "eosjs/dist/eosjs-api-interfaces";
import { ecc } from "eosjs/dist/eosjs-ecc-migration";
import { getProofWaxRequiredKeys } from "./helpers";
import { ILoginResponse } from "./interfaces";
import { version } from "./version";
import { WaxSigningApi } from "./WaxSigningApi";
import { WaxActivateRequisition } from "./ActivationRequisition";

const PROOF_WAX = 1;
const PROOF_USER = 2;
export class WaxJS {
  public readonly rpc: JsonRpc;

  public api: Api;
  public user?: ILoginResponse;

  private signingApi: WaxSigningApi;
  private waxActivateRequisition: WaxActivateRequisition;

  private readonly apiSigner: SignatureProvider;
  private readonly waxSigningURL: string;
  private readonly waxAutoSigningURL: string;
  private readonly eosApiArgs: any;
  private readonly freeBandwidth: boolean;
  private readonly feeFallback: boolean;
  private readonly metricURL: string;
  private readonly returnTempAccounts: boolean;
  private readonly activationEndpoint: string;

  private readonly verifyTx: (
    user: ILoginResponse,
    originalTx: Transaction,
    augmentedTx: Transaction
  ) => void;

  public get userAccount() {
    return this.user && this.user.account;
  }

  public get pubKeys() {
    return this.user && this.user.keys;
  }
  public get isTemp(): boolean {
    return this.user && this.user.isTemp;
  }
  public get createInfo(): any {
    return this.user && this.user.createData;
  }
  public get avatar(): string {
    return this.user?.avatarUrl;
  }
  public get trustScore(): number {
    return this.user?.trustScore;
  }
  public get trustScoreProvider(): string {
    return "https://chainchamps.com";
  }
  public get version(): string {
    return version;
  }
  public get proofVerified(): boolean {
    return this.user?.isProofVerified;
  }

  constructor({
    rpcEndpoint,
    tryAutoLogin = true,
    userAccount,
    pubKeys,
    apiSigner,
    waxSigningURL = "https://www.mycloudwallet.com",
    waxAutoSigningURL = "https://idm-api.mycloudwallet.com/v1/accounts/auto-accept/",
    eosApiArgs = {},
    freeBandwidth = true,
    feeFallback = true,
    verifyTx = defaultTxVerifier,
    metricURL = "",
    returnTempAccounts = false,
    activationEndpoint = "https://api-api.mycloudwallet.com/v1/wcw",
    relayEndpoint = "https://relay.wax.io/graphql",
    relayRegion = "us-east-2",
  }: {
    rpcEndpoint: string;
    userAccount?: string;
    pubKeys?: string[];
    tryAutoLogin?: boolean;
    apiSigner?: SignatureProvider;
    waxSigningURL?: string;
    waxAutoSigningURL?: string;
    eosApiArgs?: any;
    freeBandwidth?: boolean;
    feeFallback?: boolean;
    createData?: any;
    verifyTx?: (
      user: ILoginResponse,
      originalTx: Transaction,
      augmentedTx: Transaction
    ) => void;
    metricURL?: string;
    returnTempAccounts?: boolean;
    activationEndpoint?: string;
    relayEndpoint?: string;
    relayRegion?: string;
  }) {
    this.rpc = new JsonRpc(rpcEndpoint);
    this.signingApi = new WaxSigningApi(
      waxSigningURL,
      waxAutoSigningURL,
      this.rpc,
      metricURL,
      returnTempAccounts
    );
    this.waxActivateRequisition = new WaxActivateRequisition(
      activationEndpoint,
      this,
      relayEndpoint,
      relayRegion
    );
    this.waxSigningURL = waxSigningURL;
    this.waxAutoSigningURL = waxAutoSigningURL;
    this.apiSigner = apiSigner;
    this.eosApiArgs = eosApiArgs;
    this.freeBandwidth = freeBandwidth;
    this.feeFallback = feeFallback;
    this.metricURL = metricURL;
    this.verifyTx = verifyTx;
    this.returnTempAccounts = returnTempAccounts;
    this.activationEndpoint = activationEndpoint;
    if (userAccount && Array.isArray(pubKeys)) {
      // login from constructor
      this.receiveLogin({ account: userAccount, keys: pubKeys });
    } else {
      // try to auto-login via endpoint
      if (tryAutoLogin) {
        this.signingApi.tryAutologin().then(async (response) => {
          if (response) {
            this.receiveLogin(await this.signingApi.login());
          }
        });
      }
    }
  }

  public async login(nonce?: string): Promise<string> {
    if (!this.user) {
      this.receiveLogin(await this.signingApi.login(nonce));
    }

    return this.user.account;
  }

  public async activateRequisition(nonce?: string): Promise<string> {
    return this.user.account;
  }

  public async openActivationRequisitionModal() {
    const loginData = await this.waxActivateRequisition.openModal();
    if(loginData) {
      this.receiveLogin(loginData);
    }
  }

  public async isAutoLoginAvailable(): Promise<boolean> {
    if (this.user) {
      return true;
    } else if (await this.signingApi.tryAutologin()) {
      this.receiveLogin(await this.signingApi.login());

      return true;
    }

    return false;
  }
  public async logout() {
    this.user = null;
    this.api = null;
    if (this.signingApi) {
      if(this.user?.token) {
        const myHeaders = new Headers();
        myHeaders.append("Authorization", `Bearer ${this.user.token}`);;

        fetch(`${this.activationEndpoint}/dapp/logout`, {
          method: "DELETE",
          headers: myHeaders,
          redirect: "follow"
        })
          .then((response) => response.text())
          .then((result) => console.log(result))
          .catch((error) => console.error(error));
      } else {
        this.signingApi.logout();
      }
    }
  }

  public async userAccountProof(
    nonce: string,
    description: string,
    verify: boolean = true
  ): Promise<any> {
    if (!this.user) {
      throw new Error("User is not logged in");
    }
    const data = await this.signingApi.proofWindow(
      nonce,
      PROOF_USER,
      description
    );
    const message = nonce;
    if (!verify) {
      return { ...data, message };
    }
    for (const key of this.pubKeys) {
      if (ecc.verify(data.signature, message, key)) {
        return true;
      }
    }
    return false;
  }
  public async waxProof(nonce: string, verify: boolean = true): Promise<any> {
    if (!this.user) {
      throw new Error("User is not logged in");
    }
    const data = await this.signingApi.proofWindow(nonce, PROOF_WAX, null);
    const message = `cloudwallet-verification-${data.referer}-${nonce}-${data.accountName}`;
    if (!verify) {
      return { ...data, message };
    }
    return ecc.verify(
      data.signature,
      message,
      await getProofWaxRequiredKeys(this.rpc.endpoint)
    );
  }

  private receiveLogin(data: ILoginResponse): void {
    this.user = data;

    const signatureProvider: SignatureProvider = {
      getAvailableKeys: async () => {
        return [
          ...this.user.keys,
          ...((this.apiSigner && (await this.apiSigner.getAvailableKeys())) ||
            []),
        ];
      },
      sign: async (sigArgs) => {
        const originalTx = await this.api.deserializeTransactionWithActions(
          sigArgs.serializedTransaction
        );

        const {
          serializedTransaction,
          signatures,
        } = await this.signingApi.signing(
          originalTx,
          sigArgs.serializedTransaction,
          !this.freeBandwidth,
          this.feeFallback
        );

        const augmentedTx = await this.api.deserializeTransactionWithActions(
          serializedTransaction
        );

        this.verifyTx(this.user, originalTx, augmentedTx);

        sigArgs.serializedTransaction = serializedTransaction;

        return {
          serializedTransaction,
          signatures: [
            ...signatures,
            ...((this.apiSigner &&
              (await this.apiSigner.sign(sigArgs)).signatures) ||
              []),
          ],
        };
      },
    };

    this.api = new Api({
      ...this.eosApiArgs,
      rpc: this.rpc,
      signatureProvider,
    });
    const transact = this.api.transact.bind(this.api);
    // We monkeypatch the transact method to overcome timeouts
    // firing the pop-up which some browsers enforce, such as Safari.
    // By pre-creating the pop-up window we will interact with,
    // we ensure that it is not going to be rejected due to a delayed
    // pop up that would otherwise occur post transaction creation
    const _this = this;
    this.api.transact = async (transaction, namedParams) => {
      if(this.user?.token) {
        return await _this.waxActivateRequisition.signTransaction(transaction)
      } else {
        await this.signingApi.prepareTransaction(transaction);
        return await transact(transaction, namedParams);
      }

    };
  }
}

export function defaultTxVerifier(
  user: ILoginResponse,
  originalTx: Transaction,
  augmentedTx: Transaction,
  maxPayment: number = 1
): void {
  const { actions: originalActions } = originalTx;
  const { actions: augmentedActions } = augmentedTx;

  if (
    JSON.stringify(originalActions) !==
    JSON.stringify(
      augmentedActions.slice(augmentedActions.length - originalActions.length)
    )
  ) {
    throw new Error(
      `Augmented transaction actions has modified actions from the original.\nOriginal: ${JSON.stringify(
        originalActions,
        undefined,
        2
      )}\nAugmented: ${JSON.stringify(augmentedActions, undefined, 2)}`
    );
  }

  for (const extraAction of augmentedActions.slice(
    0,
    augmentedActions.length - originalActions.length
  )) {
    const userAuthedAction = extraAction.authorization.find((auth: any) => {
      return auth.actor === user.account;
    });

    if (userAuthedAction) {
      if (
        extraAction.account === "eosio.token" &&
        extraAction.name === "transfer"
      ) {
        const noopAction = augmentedActions[0];
        if (
          extraAction.data.to === "txfee.wax" &&
          extraAction.data.memo.startsWith("WAX fee for ") &&
          JSON.stringify(noopAction) ===
            JSON.stringify({
              account: "boost.wax",
              name: "noop",
              authorization: [
                {
                  actor: "boost.wax",
                  permission: "paybw",
                },
              ],
              data: {},
            })
        ) {
          continue;
        }
      }

      if (
        extraAction.account === "eosio" &&
        extraAction.name === "buyrambytes" &&
        extraAction.data.receiver === user.account
      ) {
        continue;
      }

      if (
        extraAction.account === "eosio" &&
        extraAction.name === "powerup" &&
        extraAction.data.payer === user.account &&
        extraAction.data.receiver === user.account
      ) {
        continue;
      }

      throw new Error(
        `Augmented transaction actions has an extra action from the original authorizing the user.\nOriginal: ${JSON.stringify(
          originalActions,
          undefined,
          2
        )}\nAugmented: ${JSON.stringify(augmentedActions, undefined, 2)}`
      );
    }
  }
}
