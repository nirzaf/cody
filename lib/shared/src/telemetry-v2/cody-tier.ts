import type { AuthStatus } from '../auth/types'

enum CodyTier {
    FreeOrPro = 1,
    Enterprise = 2,
}

export function getTier(authStatus: AuthStatus): CodyTier {
    return !authStatus.isDotCom ? CodyTier.Enterprise : CodyTier.FreeOrPro
}
