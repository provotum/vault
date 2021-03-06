import { IACMessageDefinitionObjectV3, MainProtocolSymbols, MessageSignResponse } from '@airgap/coinlib-core'
import { IACMessageType } from '@airgap/coinlib-core/serializer-v3/interfaces'
import { Injectable } from '@angular/core'
import * as BN from 'bn.js'
import * as crypto from 'crypto'
import * as provotumAirGap from 'provotum-wasm-lib'
import { Observable } from 'rxjs'
import { MnemonicSecret } from 'src/app/models/secret'
import { InteractionOperationType, InteractionService } from '../interaction/interaction.service'
import { SecretsService } from '../secrets/secrets.service'
import { SealerDecryptionPostBody } from './decryption'
import { Uint8PublicKeyShareSync } from './keygen'

@Injectable({
  providedIn: 'root'
})
export class ProvotumService {
  public keygenSync: Uint8PublicKeyShareSync
  public readonly currentSecret$: Observable<MnemonicSecret>

  constructor(private readonly secretsService: SecretsService, private readonly interactionService: InteractionService) {
    this.currentSecret$ = this.secretsService.getActiveSecretObservable()
  }

  async initProvotum(): Promise<void> {
    return new Promise((resolve) => {
      this.currentSecret$.subscribe(async (secret) => {
        const entropy: string = await this.secretsService.retrieveEntropyForSecret(secret)
        await provotumAirGap.initLib()
        const [q, params, sk, pk] = await provotumAirGap.setupElgamal(entropy)
        const rawByteSize = Buffer.byteLength(q.toString(), 'utf8')
        const byteSize = new BN(rawByteSize, 10)
        const targetValue: BN = new BN(q, 16)
        const r = this.getSecureRandomValue(targetValue, byteSize)
        const sealer = secret.label
        const keyShare = await provotumAirGap.keygen(r.toString(), sealer, params, sk, pk)

        this.keygenSync = { ...(keyShare as any), sealer }

        resolve()
      })
    })
  }

  async keygen(): Promise<void> {
    const messageSignResponse: MessageSignResponse = {
      message: JSON.stringify(this.keygenSync),
      publicKey: '',
      signature: ''
    }

    const iacObject: IACMessageDefinitionObjectV3 = {
      id: 12345678,
      type: IACMessageType.MessageSignResponse,
      protocol: MainProtocolSymbols.XTZ,
      payload: messageSignResponse
    }

    return this.interactionService.startInteraction({
      operationType: InteractionOperationType.MESSAGE_SIGN_REQUEST,
      iacMessage: [iacObject],
      messageSignResponse
    })
  }

  async decryptionSync(decryptions: any): Promise<void> {
    const messageSignResponse: MessageSignResponse = {
      message: JSON.stringify(decryptions),
      publicKey: '',
      signature: ''
    }

    const iacObject: IACMessageDefinitionObjectV3 = {
      id: 12345678,
      type: IACMessageType.MessageSignResponse,
      protocol: MainProtocolSymbols.ETH,
      payload: messageSignResponse
    }

    return this.interactionService.startInteraction({
      operationType: InteractionOperationType.MESSAGE_SIGN_REQUEST,
      iacMessage: [iacObject],
      messageSignResponse
    })
  }

  async generatePartialDecryptions(encryptions: any): Promise<SealerDecryptionPostBody> {
    return new Promise((resolve) => {
      this.currentSecret$.subscribe(async (secret) => {
        const entropy: string = await this.secretsService.retrieveEntropyForSecret(secret)
        await provotumAirGap.initLib()
        const [q, params, sk, pk] = await provotumAirGap.setupElgamal(entropy)
        const rawByteSize = Buffer.byteLength(q.toString(), 'utf8')
        const byteSize = new BN(rawByteSize, 10)
        const targetValue: BN = new BN(q, 16)
        const r = this.getSecureRandomValue(targetValue, byteSize)
        const sealer = 'bob'
        const rawDecryptions = await provotumAirGap.decrypt(encryptions, sealer, r.toString(), params, sk, pk)
        const decryptions: SealerDecryptionPostBody = { ...(rawDecryptions as any), sealer: secret.label }
        resolve(decryptions)
      })
    })
  }

  // get a secure random value x: 0 < x < n
  getSecureRandomValue = (n: BN, BYTE_SIZE: BN): BN => {
    let byteSize: number
    try {
      byteSize = BYTE_SIZE.toNumber()
    } catch {
      // https://www.ecma-international.org/ecma-262/5.1/#sec-8.5
      // used for large numbers from EC
      byteSize = 32
    }

    let randomBytes: Buffer = crypto.randomBytes(byteSize)
    let randomValue: BN = new BN(randomBytes)

    return randomValue.mod(n)
  }
}
