import { createContext, useContext, useState, type ReactNode } from "react";

export type IntakeField = {
  symptoms: string[];
  lifestyle: string[];
  familyHistory: string[];
};

interface IntakeContextProps {
  intake: IntakeField;
  setIntake: (intake: IntakeField) => void;
}

const defaultIntake: IntakeField = { symptoms: [], lifestyle: [], familyHistory: [] };
export const IntakeContext = createContext<IntakeContextProps>({ intake: defaultIntake, setIntake: () => {} });

export const IntakeProvider = ({ children }: { children: ReactNode }) => {
  const [intake, setIntakeState] = useState<IntakeField>(defaultIntake);
  return (
    <IntakeContext.Provider value={{ intake, setIntake: setIntakeState }}>
      {children}
    </IntakeContext.Provider>
  );
};

export const useIntake = () => useContext(IntakeContext);
