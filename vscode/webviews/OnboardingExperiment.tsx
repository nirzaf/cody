import { VSCodeButton } from '@vscode/webview-ui-toolkit/react'

import { CodyIDE } from '@sourcegraph/cody-shared'

import onboardingSplashImage from './cody-onboarding-splash.svg'
import type { VSCodeWrapper } from './utils/VSCodeApi'

import styles from './OnboardingExperiment.module.css'
import { ClientSignInForm } from './components/ClientSignInForm'
import { useConfig } from './utils/useConfig'

interface LoginProps {
    uiKindIsWeb: boolean
    vscodeAPI: VSCodeWrapper
    codyIDE: CodyIDE
}

// A login component which is simplified by not having an app setup flow.
export const LoginSimplified: React.FunctionComponent<React.PropsWithoutRef<LoginProps>> = ({
    uiKindIsWeb,
    vscodeAPI,
    codyIDE,
}) => {
    const authStatus = useConfig().authStatus
    const otherSignInClick = (): void => {
        vscodeAPI.postMessage({ command: 'auth', authKind: 'signin' })
    }
    const isNonVSCodeIDE = codyIDE !== CodyIDE.Web && codyIDE !== CodyIDE.VSCode
    const isCodyWebUI = (uiKindIsWeb || codyIDE === CodyIDE.Web) && !isNonVSCodeIDE
    return (
        <div className={styles.container}>
            <div className={styles.sectionsContainer}>
                <img src={onboardingSplashImage} alt="Hi, I'm Cody" className={styles.logo} />
                <div className={styles.section}>
                    <h1>Cody Free or Cody Pro</h1>
                    TODO!(sqs)
                </div>
                {isCodyWebUI || codyIDE === CodyIDE.VSCode ? (
                    <div className={styles.section}>
                        <h1>Cody Enterprise</h1>
                        <div className={styles.buttonWidthSizer}>
                            <div className={styles.buttonStack}>
                                <VSCodeButton
                                    className={styles.button}
                                    type="button"
                                    onClick={otherSignInClick}
                                >
                                    Sign In to Your Enterprise&nbsp;Instance
                                </VSCodeButton>
                            </div>
                        </div>
                        <p>
                            Learn more about{' '}
                            <a href="https://sourcegraph.com/cloud">Sourcegraph Enterprise</a>
                        </p>
                    </div>
                ) : (
                    <ClientSignInForm authStatus={authStatus} />
                )}
            </div>
            <div className={styles.terms}>
                By signing in to Cody you agree to our{' '}
                <a href="https://about.sourcegraph.com/terms">Terms of Service</a> and{' '}
                <a href="https://about.sourcegraph.com/terms/privacy">Privacy Policy</a>
            </div>
        </div>
    )
}
