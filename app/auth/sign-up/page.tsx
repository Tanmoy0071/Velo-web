import { SignUp } from "@insforge/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <SignUp signInUrl="/auth/sign-in" />
    </div>
  );
}
