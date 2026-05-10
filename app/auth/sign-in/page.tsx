import { SignIn } from "@insforge/nextjs";

export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <SignIn signUpUrl="/auth/sign-up" />
    </div>
  );
}
